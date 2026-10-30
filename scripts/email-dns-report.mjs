/**
 * DNS report for the Resend sending domain (hilm.tech; override with RESEND_DOMAIN), built from the
 * records Resend actually returns.
 * Checks each record against live DNS and confirms the existing hilm.tech mail/web records are
 * untouched. Makes no DNS changes.
 *
 *   RESEND_API_KEY=re_... npm run email:dns                      # report (domain must exist)
 *   RESEND_API_KEY=re_... npm run email:dns -- --create --region=eu-west-1
 *        creates the domain in Resend (sending only, no tracking) if it does not exist yet
 *   ... npm run email:dns -- --verify                             # ask Resend to re-check DNS
 *
 * Needs a full-access API key (sending-only keys cannot read domains).
 */
import dns from 'node:dns/promises'
import { Resend } from 'resend'

const ZONE = 'hilm.tech'
const DOMAIN = process.env.RESEND_DOMAIN?.trim() || 'hilm.tech'
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

const apiKey = process.env.RESEND_API_KEY?.trim()
if (!apiKey) {
  console.error('Set RESEND_API_KEY (full access) to read the domain records from Resend.')
  process.exit(1)
}
const resend = new Resend(apiKey)

async function findDomain() {
  const { data, error } = await resend.domains.list()
  if (error) throw new Error(`Resend domains.list failed: ${error.name}`)
  return (data?.data ?? []).find((d) => d.name === DOMAIN) ?? null
}

let domain = await findDomain()
if (!domain && flag('create')) {
  const region = option('region') || 'us-east-1'
  const { data, error } = await resend.domains.create({
    name: DOMAIN,
    region,
    capabilities: { sending: 'enabled', receiving: 'disabled' },
    openTracking: false,
    clickTracking: false,
    tls: 'opportunistic',
  })
  if (error) throw new Error(`Resend domains.create failed: ${error.name}`)
  console.log(`Created ${DOMAIN} in Resend (region ${region}).`)
  domain = data
}
if (!domain) {
  console.error(`${DOMAIN} is not in this Resend account. Re-run with --create --region=<us-east-1|eu-west-1|...>.`)
  process.exit(1)
}
if (flag('verify')) {
  const { error } = await resend.domains.verify(domain.id)
  console.log(error ? `Verification request failed: ${error.name}` : 'Asked Resend to re-check DNS.')
}

const { data: details, error } = await resend.domains.get(domain.id)
if (error || !details) throw new Error(`Resend domains.get failed: ${error?.name}`)
const records = details.records ?? []

// Resend may give names relative to the zone ("resend._domainkey.send") or to the domain
// ("resend._domainkey"); the DKIM record tells which.
const sub = DOMAIN.endsWith(`.${ZONE}`) ? DOMAIN.slice(0, -ZONE.length - 1) : ''
const dkim = records.find((r) => r.record === 'DKIM')
const zoneRelative = Boolean(sub && dkim && (dkim.name === sub || dkim.name.endsWith(`.${sub}`)))
const fqdn = (name) => {
  if (name.endsWith(`.${ZONE}`) || name === ZONE) return name
  if (name === '@' || name === '') return zoneRelative ? ZONE : DOMAIN
  return zoneRelative ? `${name}.${ZONE}` : `${name}.${DOMAIN}`
}
const netlifyName = (host) => (host === ZONE ? '@' : host.slice(0, -ZONE.length - 1))
const norm = (s) => String(s).replace(/\.$/, '').replace(/^"|"$/g, '').trim().toLowerCase()

async function lookup(type, host) {
  try {
    if (type === 'TXT') return (await dns.resolveTxt(host)).map((parts) => parts.join(''))
    if (type === 'MX') return (await dns.resolveMx(host)).map((m) => `${m.priority} ${m.exchange}`)
    if (type === 'CNAME') return await dns.resolveCname(host)
  } catch (e) {
    if (e.code === 'ENODATA' || e.code === 'ENOTFOUND') return []
    return [`(lookup failed: ${e.code})`]
  }
  return []
}

console.log(`\nResend domain: ${details.name}  status=${details.status}  region=${details.region}`)
console.log(`Capabilities: sending=${details.capabilities?.sending} receiving=${details.capabilities?.receiving}\n`)
console.log('| # | Purpose | Type | Name (Netlify DNS, zone hilm.tech) | Full hostname | Value | Priority | TTL | Resend status | Live DNS | Action |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|')

let i = 0
for (const r of records) {
  i += 1
  const host = fqdn(r.name)
  const live = await lookup(r.type, host)
  const expected = r.type === 'MX' ? `${r.priority} ${norm(r.value)}` : norm(r.value)
  const matches = live.some((v) => norm(v) === expected || norm(v).replace(/\s+/g, '') === expected.replace(/\s+/g, ''))
  let action
  if (matches) action = 'Present — no change'
  else if (r.type === 'TXT' && norm(r.value).startsWith('v=spf1') && live.some((v) => norm(v).startsWith('v=spf1'))) {
    action = 'CONFLICT — an SPF record already exists here; merge into one record, never add a second'
  } else if (r.type === 'CNAME' && live.length) action = 'CONFLICT — a different CNAME exists here'
  else if (live.length && r.type !== 'TXT') action = 'Add (other records exist at this name — keep them)'
  else action = 'Add'
  const purpose =
    r.record === 'DKIM' ? 'DKIM signing key' : r.record === 'SPF' && r.type === 'MX' ? 'Return-path MX (bounces)' : r.record === 'SPF' ? 'SPF for return path' : r.record
  console.log(
    `| ${i} | ${purpose} | ${r.type} | \`${netlifyName(host)}\` | \`${host}\` | \`${r.value}\` | ${r.priority ?? ''} | ${r.ttl} | ${r.status} | ${live.length ? live.map((v) => `\`${v}\``).join('<br>') : 'none'} | ${action} |`,
  )
}

// Existing records that must stay exactly as they are.
const protectedChecks = [
  ['MX', ZONE, 'Amelu mailbox (info@hilm.tech)'],
  ['TXT', ZONE, 'Root SPF + Google Search Console verification'],
  ['TXT', `_dmarc.${ZONE}`, 'DMARC policy'],
]
console.log('\nExisting records (must remain unchanged):')
for (const [type, host, why] of protectedChecks) {
  const live = await lookup(type, host)
  console.log(`- ${type} ${host} — ${why}: ${live.length ? live.join(' | ') : 'none found'}`)
}
const rootSpf = (await lookup('TXT', ZONE)).filter((v) => norm(v).startsWith('v=spf1'))
console.log(
  `\nRoot SPF records at ${ZONE}: ${rootSpf.length} (${rootSpf.length === 1 ? 'OK' : 'must be exactly one'}). ` +
    `Resend's SPF lives on its own hostname under ${DOMAIN}; the root SPF is not modified.`,
)
