import { afterEach, describe, expect, it, vi } from 'vitest'
import { collapseRepeatedPhrases, salvageTruncatedTranscription } from './meeting-core'
import { parseTranscriptionContent, splitWav, transcribeAudioChunk } from './meeting-transcriber'

function makeWav(seconds: number, sampleRate = 16_000) {
  const pcm = Buffer.alloc(seconds * sampleRate * 2)
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(i % 30_000, i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** Fake OpenRouter SSE response streaming `content` in small deltas. */
function sseResponse(content: string, opts: { finish?: string; stallMs?: number } = {}) {
  const encoder = new TextEncoder()
  const pieces = content.match(/[\s\S]{1,40}/g) ?? []
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const piece of pieces) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`))
        }
        if (opts.stallMs) await new Promise((resolve) => setTimeout(resolve, opts.stallMs))
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ delta: {}, finish_reason: opts.finish ?? 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
            })}\n\ndata: [DONE]\n\n`,
          ),
        )
        controller.close()
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('splitWav', () => {
  it('splits a PCM WAV into two playable halves at a sample boundary', () => {
    const wav = makeWav(4)
    const result = splitWav(wav)!
    expect(result.firstSeconds).toBe(2)
    for (const part of result.parts) {
      expect(part.toString('ascii', 0, 4)).toBe('RIFF')
      expect(part.readUInt32LE(4)).toBe(part.length - 8)
      expect(part.readUInt32LE(40)).toBe(2 * 16_000 * 2)
    }
    expect(Buffer.concat([result.parts[0].subarray(44), result.parts[1].subarray(44)])).toEqual(wav.subarray(44))
  })

  it('rejects non-WAV input', () => {
    expect(splitWav(Buffer.from('not a wav file at all, definitely not one'))).toBeNull()
  })
})

describe('transcribeAudioChunk (streamed)', () => {
  const reply = (text: string, start = 0) =>
    JSON.stringify({ segments: [{ speaker: 'Speaker 1', start, end: start + 2, text }], speakers: [{ label: 'Speaker 1' }] })
  const audioBase64 = makeWav(4).toString('base64')

  it('returns the parsed transcript and provider usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(reply('مرحبا، today we start.'))))
    const result = await transcribeAudioChunk({ apiKey: 'k', audioBase64, prompt: 'p' })
    expect(result.ok && result.data.segments[0]?.text).toBe('مرحبا، today we start.')
    expect(result.usage).toMatchObject({ total_tokens: 150 })
  })

  it('reports a whole part cut off at max_tokens as output_truncated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(reply('first line'), { finish: 'length' })))
    const result = await transcribeAudioChunk({ apiKey: 'k', audioBase64, prompt: 'p' })
    expect(!result.ok && result.code).toBe('output_truncated')
  })

  it('stops at the deadline instead of running past the function limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(reply('partial'), { stallMs: 5_000 })))
    const t = Date.now()
    const result = await transcribeAudioChunk({ apiKey: 'k', audioBase64, prompt: 'p', deadlineMs: 200 })
    expect(Date.now() - t).toBeLessThan(2_000)
    expect(!result.ok && result.code).toBe('output_truncated')
  })

  it('transcribes both halves in parallel and offsets the second half', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: Array<{ content: Array<{ text?: string }> }> }
      const second = body.messages[0]!.content[0]!.text!.includes('second half')
      return sseResponse(reply(second ? 'second half words' : 'first half words', 1))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await transcribeAudioChunk({ apiKey: 'k', audioBase64, prompt: 'p', split: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok && result.data.segments.map((s) => [s.text, s.start])).toEqual([
      ['first half words', 1],
      ['second half words', 3],
    ])
    expect(result.usage).toMatchObject({ total_tokens: 300 })
  })

  it('trims a long silent gap before sending and maps timestamps back to the recorded part', async () => {
    // 3s speech, 10s silence, 3s speech.
    const rate = 16_000
    const speech = (s: number) => Array.from({ length: s * rate }, (_, i) => Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 6000))
    const samples = Int16Array.from([...speech(3), ...new Array(10 * rate).fill(0), ...speech(3)])
    const header = makeWav(0).subarray(0, 44)
    header.writeUInt32LE(36 + samples.length * 2, 4)
    header.writeUInt32LE(samples.length * 2, 40)
    const wav = Buffer.concat([header, Buffer.from(samples.buffer)])

    let sentBytes = 0
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ content: Array<{ input_audio?: { data: string } }> }>
      }
      sentBytes = Buffer.from(body.messages[0]!.content.find((c) => c.input_audio)!.input_audio!.data, 'base64').length
      // Second speech burst sits right after the kept padding in the trimmed audio (~3.35s + 0.35s).
      return sseResponse(JSON.stringify({ s: [[1, 0, 3, 'first'], [2, 3.7, 6.7, 'second']], l: 'en' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await transcribeAudioChunk({ apiKey: 'k', audioBase64: wav.toString('base64'), prompt: 'p' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.audio).toMatchObject({ trimmed: true, originalMs: 16_000 })
    expect(result.audio.sentMs).toBeLessThan(8_000)
    expect(sentBytes).toBeLessThan(wav.length / 2)
    const [first, second] = result.data.segments
    expect(first!.start).toBeCloseTo(0, 1)
    expect(second!.start).toBeCloseTo(13, 0)
    expect(second!.end!).toBeCloseTo(16, 0)
  })

  it('sends the original audio when trimming is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(reply('x'))))
    const result = await transcribeAudioChunk({ apiKey: 'k', audioBase64, prompt: 'p', trimSilence: false })
    expect(result.ok && result.audio.trimmed).toBe(false)
  })
})

const seg = (speaker: string, start: number, text: string) =>
  JSON.stringify({ speaker, start, end: start + 3, text, language: 'mixed', languages: ['ar', 'en'] })

describe('parseTranscriptionContent', () => {
  it('parses a complete reply unchanged', () => {
    const content = `{"segments":[${seg('Speaker 1', 0, 'مرحبا، today we start.')}],"speakers":[]}`
    const data = parseTranscriptionContent(content)
    expect(data?.segments).toHaveLength(1)
    expect(data?.segments[0]?.text).toBe('مرحبا، today we start.')
  })

  it('salvages the complete segments of a reply cut off at max_tokens', () => {
    const content = `{"segments":[${seg('Speaker 1', 0, 'خلينا نراجع the API integration')},${seg(
      'Speaker 2',
      3,
      'Okay, "quoted" {braces} inside',
    )},{"speaker":"Speaker 1","start":6,"text":"وبعدها نرسل ال`
    const data = parseTranscriptionContent(content)
    expect(data?.segments.map((s) => s.text)).toEqual([
      'خلينا نراجع the API integration',
      'Okay, "quoted" {braces} inside',
    ])
  })

  it('returns null when nothing usable was produced', () => {
    expect(parseTranscriptionContent('{"segments":[{"speaker":"Speaker 1","sta')).toBeNull()
    expect(parseTranscriptionContent('I cannot transcribe this.')).toBeNull()
    expect(salvageTruncatedTranscription('{"speakers":[]}')).toBeNull()
  })

  it('drops a runaway loop of repeated segments', () => {
    const loop = Array.from({ length: 40 }, (_, i) => seg('Speaker 1', 10 + i, 'we need to check the database'))
    const content = `{"segments":[${seg('Speaker 2', 0, 'Start of the call')},${loop.join(',')}`
    const data = parseTranscriptionContent(content)
    expect(data?.segments.map((s) => s.text)).toEqual(['Start of the call', 'we need to check the database'])
  })

  it('keeps a sentence genuinely repeated two or three times', () => {
    const line = 'can you hear me now please'
    const content = `{"segments":[${seg('Speaker 1', 0, line)},${seg('Speaker 1', 3, line)},${seg('Speaker 1', 6, line)},${seg('Speaker 2', 9, 'yes')}]}`
    expect(parseTranscriptionContent(content)?.segments).toHaveLength(4)
  })

  it('keeps short genuine repeats like "yes" or "okay"', () => {
    const content = `{"segments":[${seg('Speaker 1', 0, 'Okay')},${seg('Speaker 2', 1, 'Okay')},${seg('Speaker 1', 2, 'Okay')}]}`
    expect(parseTranscriptionContent(content)?.segments).toHaveLength(3)
  })
})

describe('collapseRepeatedPhrases', () => {
  it('collapses a phrase looped inside one segment', () => {
    const looped = `So the plan is ${Array(30).fill('نرسل التقرير بكرة الصبح').join(' ')}`
    expect(collapseRepeatedPhrases(looped)).toBe('So the plan is نرسل التقرير بكرة الصبح')
  })

  it('leaves natural speech with light repetition alone', () => {
    const text = 'I think, I think we should ship it. We should ship it today, yes.'
    expect(collapseRepeatedPhrases(text)).toBe(text)
  })

  it('stays fast on long non-repeating text', () => {
    const words = Array.from({ length: 4000 }, (_, i) => `word${i}`).join(' ')
    const t = Date.now()
    expect(collapseRepeatedPhrases(words)).toBe(words)
    expect(Date.now() - t).toBeLessThan(500)
  })
})
