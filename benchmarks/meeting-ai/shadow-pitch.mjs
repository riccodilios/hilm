// Model-independent speaker check: median F0 per transcript line, then pitch-class purity per label.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = process.env.MEETING_SHADOW_DIR || join(process.env.LOCALAPPDATA ?? '.', 'hilm-shadow')
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const labels = process.argv.slice(2)
const SR = 16000
const pcmCache = new Map()
function pcmOf(file) {
  if (pcmCache.has(file)) return pcmCache.get(file)
  const wav = readFileSync(join(ROOT, file))
  let o = 12, pcm = null
  while (o + 8 <= wav.length) {
    const id = wav.toString('ascii', o, o + 4), size = wav.readUInt32LE(o + 4)
    if (id === 'data') { const d = wav.subarray(o + 8, Math.min(wav.length, o + 8 + size)); pcm = new Int16Array(d.buffer, d.byteOffset, Math.floor(d.length / 2)); break }
    o += 8 + size + (size % 2)
  }
  pcmCache.set(file, pcm)
  return pcm
}
function f0(frame) {
  let energy = 0
  for (const v of frame) energy += v * v
  if (energy / frame.length < 300 * 300) return null
  const minLag = Math.floor(SR / 350), maxLag = Math.floor(SR / 70)
  let best = 0, bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, e1 = 0, e2 = 0
    for (let i = 0; i + lag < frame.length; i += 2) { s += frame[i] * frame[i + lag]; e1 += frame[i] * frame[i]; e2 += frame[i + lag] * frame[i + lag] }
    const r = s / Math.sqrt(e1 * e2 + 1)
    if (r > best) { best = r; bestLag = lag }
  }
  return best > 0.55 ? SR / bestLag : null
}
function lineF0(meeting, startMs, endMs) {
  const vals = []
  for (const seg of meeting.segments) {
    const lo = Math.max(startMs, seg.offsetMs), hi = Math.min(endMs, seg.offsetMs + seg.durationMs)
    if (hi - lo < 300) continue
    const pcm = pcmOf(seg.file)
    for (let t = lo; t + 40 < hi; t += 60) {
      const i = Math.floor(((t - seg.offsetMs) / 1000) * SR)
      const v = f0(pcm.subarray(i, i + 640))
      if (v) vals.push(v)
    }
  }
  if (vals.length < 5) return null
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length / 2)]
}
for (const label of labels) {
  let agree = 0, total = 0
  const perMeeting = []
  for (const m of manifest) {
    const f = join(ROOT, 'out', label, `${m.id}.json`)
    if (!existsSync(f)) continue
    const j = JSON.parse(readFileSync(f, 'utf8'))
    const byLabel = new Map()
    for (const row of j.transcript) {
      const dur = row.end_ms - row.start_ms
      if (dur < 1200) continue
      const p = lineF0(m, row.start_ms, row.end_ms)
      if (!p) continue
      const cls = p >= 160 ? 'high' : 'low'
      const e = byLabel.get(row.speakerLabel) ?? { high: 0, low: 0 }
      e[cls] += dur
      byLabel.set(row.speakerLabel, e)
    }
    let a = 0, t = 0
    const desc = []
    for (const [k, e] of byLabel) { a += Math.max(e.high, e.low); t += e.high + e.low; desc.push(`${k.replace('Speaker ', 'S')}:${Math.round(e.low / 1000)}L/${Math.round(e.high / 1000)}H`) }
    agree += a; total += t
    perMeeting.push(`${m.id.slice(0, 8)} purity ${(a / Math.max(1, t)).toFixed(3)} [${desc.join(' ')}]`)
  }
  console.log(`${label}: pitch-class purity ${(agree / total).toFixed(3)} (seconds scored ${Math.round(total / 1000)})`)
  for (const line of perMeeting) console.log('   ', line)
}
