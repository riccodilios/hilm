// Compares private shadow outputs (hyp labels) against a reference label. Prints aggregates only.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = process.env.MEETING_SHADOW_DIR || join(process.env.LOCALAPPDATA ?? '.', 'hilm-shadow')
const [refLabel, ...hypLabels] = process.argv.slice(2)
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))

const AR = /[\u0600-\u06FF]/
function norm(word) {
  return word
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/^ال(?=\S{2,})/, 'ال')
    .replace(/[^\p{L}\p{N}%]/gu, '')
}
function words(transcript) {
  const out = []
  for (const row of transcript) {
    const raw = row.text.split(/\s+/).filter(Boolean)
    const toks = raw.map((w) => ({ w: norm(w), raw: w })).filter((t) => t.w)
    const span = Math.max(0, row.end_ms - row.start_ms)
    toks.forEach((t, i) => out.push({ ...t, t: row.start_ms + (toks.length > 1 ? (span * i) / toks.length : 0), spk: row.speakerLabel, ar: AR.test(t.w) }))
  }
  return out
}
function align(ref, hyp) {
  const n = ref.length, m = hyp.length
  const bt = new Uint8Array((n + 1) * (m + 1))
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1)
  for (let j = 0; j <= m; j++) { prev[j] = j; bt[j] = 2 }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; bt[i * (m + 1)] = 1
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (ref[i - 1].w === hyp[j - 1].w ? 0 : 1)
      const del = prev[j] + 1, ins = cur[j - 1] + 1
      let best = sub, b = 0
      if (del < best) { best = del; b = 1 }
      if (ins < best) { best = ins; b = 2 }
      cur[j] = best; bt[i * (m + 1) + j] = b
    }
    ;[prev, cur] = [cur, prev]
  }
  const pairs = []
  let i = n, j = m, S = 0, D = 0, I = 0
  while (i > 0 || j > 0) {
    const b = bt[i * (m + 1) + j]
    if (i > 0 && j > 0 && b === 0) { if (ref[i - 1].w !== hyp[j - 1].w) S++; pairs.push([i - 1, j - 1]); i--; j-- }
    else if (i > 0 && (b === 1 || j === 0)) { D++; i-- }
    else { I++; j-- }
  }
  return { errors: prev[m], S, D, I, pairs: pairs.reverse() }
}
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null }
function ngramRepeats(ws, n = 6) {
  const seen = new Map(); let rep = 0
  for (let i = 0; i + n <= ws.length; i++) { const k = ws.slice(i, i + n).map((x) => x.w).join(' '); seen.set(k, (seen.get(k) ?? 0) + 1) }
  for (const c of seen.values()) if (c > 1) rep += c - 1
  return rep
}
function keyTokens(ws) {
  return ws.filter((x, i) => /\d/.test(x.w) || (/^[A-Z][a-zA-Z]+/.test(x.raw) && i > 0 && !/[.?!]$/.test(ws[i - 1].raw))).map((x) => x.w)
}

const rows = []
for (const hypLabel of hypLabels) {
  const tot = { refW: 0, err: 0, refLat: 0, errLat: 0, refAr: 0, errAr: 0, ts: [], spkOk: 0, spkN: 0, keyN: 0, keyHit: 0, rep: 0, refRep: 0, lowParts: 0, parts: 0, cost: 0, sec: 0, attempts: 0, failed: 0, maxLat: 0 }
  for (const m of manifest) {
    const rf = join(ROOT, 'out', refLabel, `${m.id}.json`), hf = join(ROOT, 'out', hypLabel, `${m.id}.json`)
    if (!existsSync(rf) || !existsSync(hf)) continue
    const R = JSON.parse(readFileSync(rf, 'utf8')), H = JSON.parse(readFileSync(hf, 'utf8'))
    const rw = words(R.transcript), hw = words(H.transcript)
    const a = align(rw, hw)
    const lat = align(rw.filter((x) => !x.ar), hw.filter((x) => !x.ar))
    const ar = align(rw.filter((x) => x.ar), hw.filter((x) => x.ar))
    const vote = new Map()
    for (const [i, j] of a.pairs) {
      if (rw[i].w !== hw[j].w) continue
      tot.ts.push(Math.abs(rw[i].t - hw[j].t) / 1000)
      const k = hw[j].spk; const v = vote.get(k) ?? new Map(); v.set(rw[i].spk, (v.get(rw[i].spk) ?? 0) + 1); vote.set(k, v)
    }
    const map = new Map([...vote].map(([k, v]) => [k, [...v].sort((x, y) => y[1] - x[1])[0][0]]))
    let ok = 0, nn = 0
    for (const [i, j] of a.pairs) { if (rw[i].w !== hw[j].w) continue; nn++; if (map.get(hw[j].spk) === rw[i].spk) ok++ }
    const keys = keyTokens(rw); const bag = new Map(); for (const x of hw) bag.set(x.w, (bag.get(x.w) ?? 0) + 1)
    let hit = 0; for (const k of keys) { const c = bag.get(k) ?? 0; if (c > 0) { hit++; bag.set(k, c - 1) } }
    for (const seg of m.segments) {
      const lo = seg.offsetMs, hi = seg.offsetMs + seg.durationMs
      const rc = rw.filter((x) => x.t >= lo && x.t < hi).length, hc = hw.filter((x) => x.t >= lo && x.t < hi).length
      tot.parts++; if (rc >= 20 && hc < rc * 0.6) tot.lowParts++
    }
    const meetingRow = { meeting: m.id.slice(0, 8), sec: m.durationSeconds, refWords: rw.length, hypWords: hw.length, wer: +(a.errors / Math.max(1, rw.length)).toFixed(3), latWer: +(lat.errors / Math.max(1, rw.filter((x) => !x.ar).length)).toFixed(3), arWer: rw.some((x) => x.ar) ? +(ar.errors / Math.max(1, rw.filter((x) => x.ar).length)).toFixed(3) : null, spkAcc: +(ok / Math.max(1, nn)).toFixed(3), refSpk: R.roster.length, hypSpk: H.roster.length, keyRecall: keys.length ? +(hit / keys.length).toFixed(3) : null, rep: ngramRepeats(hw), refRep: ngramRepeats(rw) }
    rows.push([hypLabel, JSON.stringify(meetingRow)])
    tot.refW += rw.length; tot.err += a.errors
    tot.refLat += rw.filter((x) => !x.ar).length; tot.errLat += lat.errors
    tot.refAr += rw.filter((x) => x.ar).length; tot.errAr += ar.errors
    tot.spkOk += ok; tot.spkN += nn; tot.keyN += keys.length; tot.keyHit += hit; tot.rep += meetingRow.rep; tot.refRep += meetingRow.refRep
    for (const p of H.parts) { tot.cost += p.costUsd; tot.sec += p.durationMs / 1000; tot.attempts += p.attempts; if (!p.ok) tot.failed++; tot.maxLat = Math.max(tot.maxLat, p.latencyMs) }
  }
  console.log(`${hypLabel} vs ${refLabel}: WER ${(tot.err / tot.refW).toFixed(3)} latinWER ${(tot.errLat / tot.refLat).toFixed(3)} arabicWER ${(tot.errAr / Math.max(1, tot.refAr)).toFixed(3)} (arWords ${tot.refAr}/${tot.refW}) spkAcc ${(tot.spkOk / tot.spkN).toFixed(3)} tsMed ${pct(tot.ts, 0.5)?.toFixed(2)} tsP90 ${pct(tot.ts, 0.9)?.toFixed(2)} tsMax ${pct(tot.ts, 1)?.toFixed(1)} keyRecall ${(tot.keyHit / tot.keyN).toFixed(3)} (${tot.keyN}) repeats ${tot.rep} (ref ${tot.refRep}) lowParts ${tot.lowParts}/${tot.parts} | $/h ${((tot.cost / tot.sec) * 3600).toFixed(4)} attempts ${tot.attempts} failed ${tot.failed} maxLat ${tot.maxLat}`)
}
for (const r of rows) console.log(r.join(' '))
