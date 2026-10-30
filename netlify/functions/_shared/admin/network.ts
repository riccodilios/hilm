/**
 * Client network for the admin IP lock. Exact addresses change too often (mobile, ISP renewals),
 * so access is bound to the network: IPv4 /24 or IPv6 /64.
 */
import { isIP } from 'node:net'

export function clientIp(request: Request): string | null {
  const direct = request.headers.get('x-nf-client-connection-ip')?.trim()
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = direct || forwarded || ''
  return isIP(ip) ? ip : null
}

function expandIpv6(ip: string): string[] | null {
  let address = ip.toLowerCase()
  const zone = address.indexOf('%')
  if (zone >= 0) address = address.slice(0, zone)
  // IPv4-mapped / embedded tail (::ffff:1.2.3.4)
  const v4 = address.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const parts = v4[1]!.split('.').map(Number)
    address = address.replace(v4[1]!, `${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`)
  }
  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail]
  if (groups.length !== 8) return null
  return groups.map((g) => g.padStart(4, '0'))
}

/** "203.0.113.0/24" or "2001:0db8:0001:0002::/64"; null for anything unparseable. */
export function networkPrefix(ip: string | null): string | null {
  if (!ip) return null
  const kind = isIP(ip)
  if (kind === 4) {
    const parts = ip.split('.')
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }
  if (kind === 6) {
    const groups = expandIpv6(ip)
    if (!groups) return null
    // IPv4-mapped addresses are really IPv4.
    if (groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff') {
      const a = parseInt(groups[6]!, 16)
      const b = parseInt(groups[7]!, 16)
      return `${a >> 8}.${a & 255}.${b >> 8}.0/24`
    }
    return `${groups.slice(0, 4).join(':')}::/64`
  }
  return null
}
