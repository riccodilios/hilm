/**
 * Live meeting-AI cost/quality benchmark against OpenRouter. Skipped unless MEETING_BENCHMARK=1
 * (see `npm run bench:meeting-ai -- <label>`). Never runs in CI.
 *
 * Audio is synthesized locally with Windows OneCore voices (English + Saudi Arabic), cut into parts by
 * the production segmenter, and sent through the production prompt builder, transcriber, stitcher and
 * analysis runner. Raw provider usage is captured per HTTP call by wrapping fetch, so the numbers are
 * what OpenRouter reported — not estimates. Results go to benchmarks/meeting-ai/<label>.json.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PcmSegmenter } from '../../../src/shared/meetings/recorder/segmenter'
import { MEETING_SAMPLE_RATE, samplesToMs } from '../../../src/shared/meetings/recorder/wav-encoder'
import { getAiRuntimeConfig } from './ai-config'
import {
  buildTranscriptionPrompt,
  stitchChunkSegments,
  type AnalysisLine,
  type RosterSpeaker,
  type StitchedSegment,
  MEETING_DEFAULT_VOCABULARY,
  MEETING_TRANSCRIBE_MODEL,
} from './meeting-core'
import { runMeetingAnalysis } from './meeting-analysis'
import { parseTranscriptionContent, transcribeAudioChunk } from './meeting-transcriber'

const enabled = process.env.MEETING_BENCHMARK === '1' && process.platform === 'win32'
const LABEL = (process.env.MEETING_BENCHMARK_LABEL || 'run').replace(/[^a-z0-9_-]/gi, '')
/** Analysis always runs on the production analysis model so only the STT model varies. */
const ANALYSIS_MODEL = 'google/gemini-2.5-flash'
/** MEETING_BENCHMARK_STT_MODEL compares transcription models on identical audio/prompts/parsing. */
const STT_MODEL = process.env.MEETING_BENCHMARK_STT_MODEL?.trim() || MEETING_TRANSCRIBE_MODEL
const ENGINE_VOCABULARY = MEETING_DEFAULT_VOCABULARY
/** MEETING_BENCHMARK_TRIM=0 sends untrimmed audio (A/B for silence trimming). */
const TRIM = process.env.MEETING_BENCHMARK_TRIM !== '0'
/** MEETING_BENCHMARK_ANALYSIS=0 skips analysis (STT-only comparisons). */
const ANALYSIS = process.env.MEETING_BENCHMARK_ANALYSIS !== '0'
const ONLY = (process.env.MEETING_BENCHMARK_SCENARIOS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** `pitch` renders the voice through SSML prosody so one installed voice can play two speakers. */
type Line = { voice: string; text: string; pauseAfterMs?: number; pitch?: string }
type Scenario = {
  name: string
  locale: 'en' | 'ar'
  projectName: string
  title: string
  lines: Line[]
  /** Background noise amplitude (PCM16); default 160. */
  noise?: number
  brands: string[]
  /** Arabic-letter spellings of English words — must not appear (English stays in Latin script). */
  forbidden: string[]
  decisionPatterns: RegExp[]
  actionPatterns: RegExp[]
  hierarchical?: boolean
}

const ZIRA = 'Microsoft Zira'
const DAVID = 'Microsoft David'
const MARK = 'Microsoft Mark'
const NAAYF = 'Microsoft Naayf'

const SCENARIOS: Scenario[] = [
  {
    name: 'english_two_speakers',
    locale: 'en',
    projectName: 'Mobile app',
    title: 'Mobile app redesign planning',
    brands: ['Omar'],
    forbidden: [],
    decisionPatterns: [/sign ?up|email/, /lazy/],
    actionPatterns: [/wireframe/, /omar|backend/, /support|invit/],
    hierarchical: true,
    lines: [
      { voice: ZIRA, text: 'Good morning everyone. Thanks for joining the weekly planning meeting for the mobile app redesign.' },
      { voice: DAVID, text: 'Morning. I reviewed the design files yesterday and I have a few concerns about the onboarding flow.' },
      { voice: ZIRA, text: "Okay, let's start there. What is the main problem you noticed?" },
      { voice: DAVID, text: 'The signup screen asks for too much information up front. Most people will abandon it before they finish.' },
      { voice: ZIRA, text: 'That makes sense. Could we move the profile questions to a later step, after the first login?' },
      { voice: DAVID, text: 'Yes, I think that would work. We would only ask for an email address and a password at the beginning.' },
      { voice: ZIRA, text: "Great. Then let's decide that the signup screen will only collect email and password." },
      { voice: DAVID, text: 'Agreed. I will update the wireframes and share them with the team before Thursday.' },
      { voice: ZIRA, text: 'Perfect. The next topic is the notification settings. Customers keep asking for a quiet mode during the weekend.' },
      { voice: DAVID, text: 'We could add a simple toggle in the settings page. It should be easy to build.' },
      { voice: ZIRA, text: 'I like that idea, but we need to check with the backend team about scheduling.', pauseAfterMs: 4000 },
      { voice: DAVID, text: 'I can talk to Omar about it this afternoon, and I will report back tomorrow.' },
      { voice: ZIRA, text: 'Thank you. Another item is the performance of the dashboard. It still takes several seconds to load on older phones.' },
      { voice: DAVID, text: 'I measured it last week. Most of the delay comes from loading every chart at the same time.' },
      { voice: ZIRA, text: 'So should we load the charts only when the user scrolls to them?' },
      { voice: DAVID, text: 'Exactly. Lazy loading should cut the waiting time roughly in half.' },
      { voice: ZIRA, text: "Alright. Let's make lazy loading the priority for the next sprint." },
      { voice: DAVID, text: 'Sounds good. Should we also invite the support team to the next review?' },
      { voice: ZIRA, text: 'Yes, please send them an invitation. Their feedback about customer complaints would be really helpful.' },
      { voice: DAVID, text: 'Will do. Is there anything else we need to cover today?' },
      { voice: ZIRA, text: 'I think that is everything. Thanks everyone, and see you next week.' },
    ],
  },
  {
    name: 'mixed_arabic_english',
    locale: 'ar',
    projectName: 'Visma integration',
    title: 'مراجعة تكامل Visma',
    brands: ['Visma', 'Milkman', 'Netlify', 'Supabase', 'API'],
    // Brand names plus the English phrases Naayf says ("we need to review", "integration", "production").
    forbidden: ['فيزما', 'فيسما', 'ميلكمان', 'ملكمان', 'نتلفاي', 'سوبابيس', 'ويد تو', 'ريفيو', 'انتجريشن', 'انتشن', 'ريدكشن', 'برودكشن', 'شوكشن'],
    decisionPatterns: [/cach|تخزين|كاش/],
    actionPatterns: [/cach|كاش|تخزين/, /demo|عرض|milkman/, /invit|دعو/],
    lines: [
      { voice: NAAYF, text: 'السلام عليكم، خلينا نبدأ الاجتماع. اليوم we need to review the Visma integration.' },
      { voice: ZIRA, text: 'Sounds good. I finished the API documentation yesterday and shared it with the team.' },
      { voice: NAAYF, text: 'ممتاز. بس عندي ملاحظة على الـ backend، الأداء بطيء شوي في production.' },
      { voice: ZIRA, text: 'I noticed that too. The database queries on the reports page are not optimized.' },
      { voice: NAAYF, text: 'طيب، وش رايك نضيف caching قبل نهاية الأسبوع؟' },
      { voice: ZIRA, text: 'Yes, I can add caching to the reports endpoint by Thursday.' },
      { voice: NAAYF, text: 'زين. والشي الثاني، شركة Milkman طلبت demo للنظام الجديد.' },
      { voice: ZIRA, text: 'When do they want the demo?' },
      { voice: NAAYF, text: 'قالوا الأسبوع الجاي، يوم الأحد إن شاء الله.', pauseAfterMs: 4000 },
      { voice: NAAYF, text: 'أحمد بيجهز العرض، وأنا بتواصل مع Milkman عشان نأكد الموعد.' },
      { voice: ZIRA, text: 'Great. Should we also invite the support team to the demo?' },
      { voice: NAAYF, text: 'أكيد، ابعثي لهم دعوة today please.' },
      { voice: ZIRA, text: 'I will send the invitation this afternoon.' },
      { voice: NAAYF, text: 'آخر نقطة، الـ deployment على Netlify لازم يكون جاهز قبل الـ demo.' },
      { voice: ZIRA, text: 'Agreed. I will run the final tests on Supabase tomorrow morning.' },
      { voice: NAAYF, text: 'تمام، شكراً للجميع، نشوفكم الأسبوع الجاي.' },
    ],
  },
  {
    // Only one Arabic voice is installed; the second speaker is the same voice pitched up.
    name: 'arabic_conversation',
    locale: 'ar',
    projectName: 'فرع الرياض',
    title: 'اجتماع فريق المبيعات',
    brands: ['خالد', 'سارة', 'الرياض', 'جدة'],
    forbidden: [],
    decisionPatterns: [/جده|جدة|فرع/],
    actionPatterns: [/عرض|تقرير/, /عميل|عملاء|اتصال/],
    lines: [
      { voice: NAAYF, text: 'صباح الخير يا جماعة، خلونا نبدأ اجتماع فريق المبيعات لهذا الأسبوع.' },
      { voice: NAAYF, pitch: '+35%', text: 'صباح النور. عندي تحديث بسيط عن أرقام الشهر الماضي في فرع الرياض.' },
      { voice: NAAYF, text: 'تفضلي يا سارة، كيف كانت المبيعات؟' },
      { voice: NAAYF, pitch: '+35%', text: 'المبيعات زادت عشرين بالمية مقارنة بالشهر اللي قبله، وأغلب الزيادة جات من العملاء الجدد.' },
      { voice: NAAYF, text: 'ممتاز، هذا خبر حلو. وش السبب برأيك؟' },
      { voice: NAAYF, pitch: '+35%', text: 'أعتقد الحملة الإعلانية ساعدت كثير، وكمان خالد سوى زيارات للشركات الكبيرة.' },
      { voice: NAAYF, text: 'طيب، والمشكلة اللي كانت عندنا مع التوصيل، انحلت ولا لا؟' },
      { voice: NAAYF, pitch: '+35%', text: 'للأسف لا، لسا فيه تأخير في الطلبات اللي تروح لجدة.', pauseAfterMs: 3000 },
      { voice: NAAYF, text: 'لازم نحل هالموضوع بسرعة، العملاء بدوا يشتكون.' },
      { voice: NAAYF, pitch: '+35%', text: 'اقترح نفتح فرع صغير في جدة بدل ما نشحن كل شي من الرياض.' },
      { voice: NAAYF, text: 'فكرة زينة، خلينا نعتمد فتح فرع في جدة بداية الربع الجاي.' },
      { voice: NAAYF, pitch: '+35%', text: 'تمام، أنا بجهز تقرير عن التكاليف وأرسله لك يوم الخميس.' },
      { voice: NAAYF, text: 'وأنا بتصل بالعملاء اللي اشتكوا وأعتذر لهم عن التأخير.' },
      { voice: NAAYF, pitch: '+35%', text: 'شي ثاني، نحتاج نحدد موعد العرض التقديمي للإدارة.' },
      { voice: NAAYF, text: 'خليه يوم الأحد الساعة عشرة الصبح إن شاء الله.' },
      { voice: NAAYF, pitch: '+35%', text: 'تمام، بحجز القاعة وأبلغ خالد.' },
      { voice: NAAYF, text: 'شكراً سارة، شكراً للجميع، نلتقي الأسبوع الجاي.' },
    ],
  },
  {
    // Several parts: four speakers, a speaker switching between full English and Arabic
    // sentences, company names, a long pause, and louder background noise.
    name: 'natural_meeting_long',
    locale: 'en',
    projectName: 'Q4 roadmap',
    title: 'Q4 roadmap sync',
    noise: 450,
    brands: ['Visma', 'Milkman', 'Netlify', 'Supabase', 'Stripe', 'Omar', 'Layla'],
    forbidden: ['فيزما', 'فيسما', 'ميلكمان', 'ملكمان', 'نتلفاي', 'سوبابيس', 'سترايب', 'برودكشن', 'ريليز', 'داشبورد'],
    decisionPatterns: [/stripe|payment|دفع/, /freeze|release|friday/],
    actionPatterns: [/milkman|contract|عقد/, /visma|sync/, /netlify|staging|deploy/],
    lines: [
      { voice: ZIRA, text: "Hi everyone, thanks for joining. This is the Q4 roadmap sync, and we have a lot to cover, so let's get started." },
      { voice: DAVID, text: 'Sure. Before we start, I want to mention that the Netlify deploys have been failing intermittently since Monday.' },
      { voice: MARK, text: 'I saw that too. It looks like the build runs out of memory when it bundles the reports module.' },
      { voice: ZIRA, text: "Okay, let's put that on the list. First, where are we with the Visma integration?" },
      { voice: NAAYF, text: 'The Visma sync is working for invoices, but customers and payments are still missing.' },
      { voice: NAAYF, text: 'بصراحة الجزء الأصعب هو الـ payments، لأن Visma عندهم limits على عدد الطلبات.' },
      { voice: DAVID, text: 'How many requests per minute do they allow?' },
      { voice: NAAYF, text: 'Around sixty per minute, so we need a queue on our side.' },
      { voice: ZIRA, text: 'Can we use the same queue we built for the Supabase webhooks?' },
      { voice: MARK, text: 'Probably, yes. It already handles retries and backoff, so it should be a small change.' },
      { voice: ZIRA, text: "Great. Let's decide that the Visma sync reuses the existing webhook queue." },
      { voice: NAAYF, text: 'تمام، أنا بخلص الـ sync للعملاء والدفعات قبل نهاية الأسبوع الجاي.', pauseAfterMs: 2500 },
      { voice: ZIRA, text: 'Next topic is Milkman. Layla, you spoke with them yesterday, right?' },
      { voice: DAVID, text: "Layla couldn't join today, but she sent me notes. Milkman wants a pilot for three of their warehouses." },
      { voice: MARK, text: 'Do they want the pilot before or after the new year?' },
      { voice: DAVID, text: 'Before the new year if possible. They also asked about pricing for more than fifty users.' },
      { voice: NAAYF, text: 'أعتقد لازم نجهز عرض سعر خاص لهم، لأن Milkman عميل كبير.' },
      { voice: ZIRA, text: 'Agreed. David, can you prepare the Milkman contract draft with Omar by Wednesday?' },
      { voice: DAVID, text: 'Yes, I will work on it with Omar and send it to everyone by Wednesday afternoon.', pauseAfterMs: 15000 },
      { voice: ZIRA, text: 'Sorry about that, I had to take a quick call. Where were we? Right, payments.' },
      { voice: MARK, text: 'We compared providers last week. Stripe has better documentation and supports the local cards we need.' },
      { voice: NAAYF, text: 'بس الرسوم عند Stripe أعلى شوي، لازم ناخذها بعين الاعتبار.' },
      { voice: MARK, text: 'True, but the integration time is much shorter, and that matters more for Q4.' },
      { voice: ZIRA, text: "Okay, then the decision is to go with Stripe for payments this quarter." },
      { voice: ZIRA, text: 'Now back to the Netlify problem. Mark, what do you need to fix the build?' },
      { voice: MARK, text: 'I want to split the reports bundle and raise the memory limit on the staging site first.' },
      { voice: DAVID, text: 'Can you test it on staging before we touch production?' },
      { voice: MARK, text: 'Yes, I will deploy the fix to the Netlify staging site tomorrow and report back.' },
      { voice: NAAYF, text: 'وإذا نجح، نقدر ننزله على production يوم الأحد.' },
      { voice: ZIRA, text: "Last thing: the release freeze. I propose we freeze new features on Friday the twentieth." },
      { voice: DAVID, text: 'That works for me, as long as bug fixes can still go out.' },
      { voice: ZIRA, text: "Yes, bug fixes are fine. So we freeze features on Friday the twentieth." },
      { voice: NAAYF, text: 'تمام، متفقين. شكراً للجميع.' },
      { voice: ZIRA, text: 'Thanks everyone. See you next week.' },
    ],
  },
]

const ACTIVE_SCENARIOS = ONLY.length ? SCENARIOS.filter((s) => ONLY.includes(s.name)) : SCENARIOS

const GAP_MS = 600

function speakerKey(line: Line) {
  return line.pitch ? `${line.voice}@${line.pitch}` : line.voice
}

function pitchedSsml(text: string, pitch: string) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-SA"><prosody pitch="${pitch}" rate="1.05">${escaped}</prosody></speak>`
}

// ── Provider usage capture ─────────────────────────────────────────────────

type ProviderCall = {
  title: string
  status: number
  requestChars: number
  usage: Record<string, unknown> | null
  /** OpenRouter generation id and the upstream provider that served the call. */
  generationId?: string | null
  provider?: string | null
}

const calls: ProviderCall[] = []
const pending: Promise<void>[] = []
const originalFetch = globalThis.fetch

function lastUsageFromSse(text: string) {
  let usage: Record<string, unknown> | null = null
  let generationId: string | null = null
  let provider: string | null = null
  for (const line of text.split('\n')) {
    const data = line.startsWith('data:') ? line.slice(5).trim() : ''
    if (!data || data === '[DONE]') continue
    try {
      const chunk = JSON.parse(data) as { usage?: Record<string, unknown>; id?: string; provider?: string }
      if (chunk.usage) usage = chunk.usage
      if (chunk.id) generationId = chunk.id
      if (chunk.provider) provider = chunk.provider
    } catch {
      // keep-alive comments and partial frames
    }
  }
  return { usage, generationId, provider }
}

/**
 * MEETING_BENCHMARK_STT_ENDPOINT pins transcription calls to one OpenRouter endpoint tag
 * (e.g. google-ai-studio/flex) without fallbacks. Benchmark-only; production routing is untouched.
 */
const STT_ENDPOINT = process.env.MEETING_BENCHMARK_STT_ENDPOINT?.trim() || null
/** MEETING_BENCHMARK_STT_REASONING=minimal|low|none caps thinking on models that reason by default. */
const STT_REASONING = process.env.MEETING_BENCHMARK_STT_REASONING?.trim() || null

function withSttRouting(init?: RequestInit): RequestInit | undefined {
  if ((!STT_ENDPOINT && !STT_REASONING) || typeof init?.body !== 'string') return init
  if (new Headers(init.headers).get('X-Title') !== 'Hilm Meeting Transcription') return init
  const body = JSON.parse(init.body) as Record<string, unknown>
  if (STT_ENDPOINT) body.provider = { only: [STT_ENDPOINT], allow_fallbacks: false }
  if (STT_REASONING) body.reasoning = { effort: STT_REASONING }
  return { ...init, body: JSON.stringify(body) }
}

function installFetchCapture() {
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], rawInit?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const init = url.includes('openrouter.ai') ? withSttRouting(rawInit) : rawInit
    const response = await originalFetch(input, init)
    if (!url.includes('openrouter.ai')) return response
    const headers = new Headers(init?.headers)
    const record: ProviderCall = {
      title: headers.get('X-Title') ?? '',
      status: response.status,
      requestChars: typeof init?.body === 'string' ? init.body.length : 0,
      usage: null,
    }
    calls.push(record)
    const copy = response.clone()
    pending.push(
      copy
        .text()
        .then((text) => {
          if ((copy.headers.get('content-type') ?? '').includes('text/event-stream') || text.startsWith('data:')) {
            Object.assign(record, lastUsageFromSse(text))
          } else {
            record.usage = (JSON.parse(text) as { usage?: Record<string, unknown> }).usage ?? null
          }
        })
        .catch(() => undefined),
    )
    return response
  }
}

async function drainCalls(from: number) {
  await Promise.all(pending.splice(0))
  return calls.slice(from)
}

function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function detail(usage: Record<string, unknown> | null, group: string, key: string) {
  const bag = usage?.[group]
  return bag && typeof bag === 'object' ? num((bag as Record<string, unknown>)[key]) : 0
}

function summarizeCalls(list: ProviderCall[]) {
  const sum = { calls: list.length, promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, audioTokens: 0, reasoningTokens: 0, costUsd: 0, costReported: 0 }
  for (const call of list) {
    sum.promptTokens += num(call.usage?.prompt_tokens)
    sum.completionTokens += num(call.usage?.completion_tokens)
    sum.totalTokens += num(call.usage?.total_tokens)
    sum.cachedTokens += detail(call.usage, 'prompt_tokens_details', 'cached_tokens')
    sum.audioTokens += detail(call.usage, 'prompt_tokens_details', 'audio_tokens')
    sum.reasoningTokens += detail(call.usage, 'completion_tokens_details', 'reasoning_tokens')
    if (typeof call.usage?.cost === 'number') {
      sum.costUsd += call.usage.cost
      sum.costReported += 1
    }
  }
  sum.costUsd = Number(sum.costUsd.toFixed(6))
  return { ...sum, textPromptTokens: sum.promptTokens - sum.audioTokens }
}

// ── Audio helpers ──────────────────────────────────────────────────────────

function loadApiKey() {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim()
  if (fromEnv) return fromEnv
  if (!existsSync('.env')) return ''
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((row) => row.startsWith('OPENROUTER_API_KEY='))
  return line?.slice('OPENROUTER_API_KEY='.length).trim().replace(/^["']|["']$/g, '') ?? ''
}

/** WinRT SpeechSynthesizer: OneCore voices (incl. ar-SA) render 16 kHz mono PCM16. */
function synthesize(dir: string, jobs: Array<{ voice: string; text: string; path: string; ssml?: string | null }>) {
  const jobsPath = join(dir, 'jobs.json')
  const scriptPath = join(dir, 'synth.ps1')
  writeFileSync(jobsPath, JSON.stringify(jobs), 'utf8')
  writeFileSync(
    scriptPath,
    [
      'param([string]$JobsPath)',
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
      '[Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime] | Out-Null',
      '$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer',
      '$voices = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices',
      '$jobs = Get-Content -Raw -Encoding UTF8 $JobsPath | ConvertFrom-Json',
      'foreach ($job in $jobs) {',
      '  $synth.Voice = ($voices | Where-Object { $_.DisplayName -eq $job.voice })[0]',
      '  $op = if ($job.ssml) { $synth.SynthesizeSsmlToStreamAsync($job.ssml) } else { $synth.SynthesizeTextToStreamAsync($job.text) }',
      '  $task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($op))',
      '  $task.Wait(-1) | Out-Null',
      '  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($task.Result)',
      '  $fs = [System.IO.File]::Create($job.path); $net.CopyTo($fs); $fs.Close()',
      '}',
    ].join('\r\n'),
    'utf8',
  )
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, jobsPath], { stdio: 'pipe' })
}

function readWavPcm(path: string): Int16Array {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(24) !== MEETING_SAMPLE_RATE) throw new Error(`${path} is not 16 kHz`)
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      const bytes = buf.subarray(offset + 8, offset + 8 + size)
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error(`No data chunk in ${path}`)
}

function addNoise(pcm: Int16Array, amplitude = 160) {
  let seed = 1234567
  for (let i = 0; i < pcm.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const noise = ((seed / 0x7fffffff) * 2 - 1) * amplitude
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i]! + noise)))
  }
  return pcm
}

function wavBase64(chunks: Int16Array[]) {
  const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples * 2, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(MEETING_SAMPLE_RATE, 24)
  header.writeUInt32LE(MEETING_SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples * 2, 40)
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)))
  return Buffer.concat([header, body]).toString('base64')
}

// ── Quality metrics ────────────────────────────────────────────────────────

const ARABIC = /[\u0600-\u06FF]/

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .replace(/[،؟؛]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function wordErrors(reference: string[], hypothesis: string[]) {
  const rows = reference.length + 1
  const cols = hypothesis.length + 1
  const d = new Array<number>(rows * cols)
  for (let i = 0; i < rows; i += 1) d[i * cols] = i
  for (let j = 0; j < cols; j += 1) d[j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
      d[i * cols + j] = Math.min(d[(i - 1) * cols + j]! + 1, d[i * cols + j - 1]! + 1, d[(i - 1) * cols + j - 1]! + cost)
    }
  }
  const errors = d[rows * cols - 1]!
  return { errors, wer: reference.length ? errors / reference.length : 0 }
}

function percentile(values: number[], p: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits))
}

type Utterance = { voice: string; text: string; startMs: number; endMs: number }

function measureQuality(scenario: Scenario, utterances: Utterance[], stitched: StitchedSegment[]) {
  const refWords = normalizeWords(utterances.map((u) => u.text).join(' '))
  const hypWords = normalizeWords(stitched.map((row) => row.text).join(' '))
  const all = wordErrors(refWords, hypWords)
  const latin = wordErrors(
    refWords.filter((w) => !ARABIC.test(w)),
    hypWords.filter((w) => !ARABIC.test(w)),
  )
  const arabicRef = refWords.filter((w) => ARABIC.test(w))
  const arabic = arabicRef.length ? wordErrors(arabicRef, hypWords.filter((w) => ARABIC.test(w))) : null

  // Align each line to the utterance it overlaps most (word overlap).
  const utteranceWords = utterances.map((u) => new Set(normalizeWords(u.text)))
  const aligned = stitched.map((row) => {
    const words = normalizeWords(row.text)
    let best = { index: 0, score: -1 }
    utteranceWords.forEach((set, index) => {
      const score = words.filter((w) => set.has(w)).length / Math.max(1, words.length)
      if (score > best.score) best = { index, score }
    })
    return { row, index: best.index, voice: utterances[best.index]!.voice, weight: words.length }
  })

  const votes = new Map<string, Map<string, number>>()
  for (const item of aligned) {
    const entry = votes.get(item.row.speakerLabel) ?? new Map<string, number>()
    entry.set(item.voice, (entry.get(item.voice) ?? 0) + item.weight)
    votes.set(item.row.speakerLabel, entry)
  }
  const labelVoice = new Map([...votes].map(([label, v]) => [label, [...v].sort((a, b) => b[1] - a[1])[0]![0]]))
  const totalWeight = aligned.reduce((sum, item) => sum + item.weight, 0)
  const correct = aligned.reduce((sum, item) => sum + (labelVoice.get(item.row.speakerLabel) === item.voice ? item.weight : 0), 0)

  // Timestamp error: first line aligned to each utterance vs the utterance's true start.
  const seen = new Set<number>()
  const startErrors: number[] = []
  for (const item of aligned) {
    if (seen.has(item.index)) continue
    seen.add(item.index)
    startErrors.push(Math.abs(item.row.start_ms - utterances[item.index]!.startMs) / 1000)
  }

  const hypothesisText = stitched.map((row) => row.text).join('\n')
  const lower = hypothesisText.toLowerCase()
  const expectedArabicLines = utterances.filter((u) => ARABIC.test(u.text)).length
  return {
    referenceWords: refWords.length,
    hypothesisWords: hypWords.length,
    wer: round(all.wer),
    latinWer: round(latin.wer),
    arabicWer: arabic ? round(arabic.wer) : null,
    speakerAccuracy: round(totalWeight ? correct / totalWeight : 0),
    speakerLabels: Object.fromEntries(labelVoice),
    distinctVoicesFound: new Set(labelVoice.values()).size,
    expectedVoices: new Set(utterances.map((u) => u.voice)).size,
    brandsFound: scenario.brands.filter((brand) => lower.includes(brand.toLowerCase())),
    brandsMissing: scenario.brands.filter((brand) => !lower.includes(brand.toLowerCase())),
    transliterations: scenario.forbidden.filter((word) => hypothesisText.includes(word)),
    arabicLines: stitched.filter((row) => ARABIC.test(row.text)).length,
    expectedArabicLines,
    codeSwitchLines: stitched.filter((row) => ARABIC.test(row.text) && /[a-z]{3,}/i.test(row.text)).length,
    translatedToEnglish: expectedArabicLines > 0 && stitched.filter((row) => ARABIC.test(row.text)).length === 0,
    startErrorMedianS: percentile(startErrors, 0.5),
    startErrorP90S: percentile(startErrors, 0.9),
    lines: stitched.length,
    transcript: stitched.map((row) => `${row.speakerLabel} @${(row.start_ms / 1000).toFixed(1)}s [${row.language ?? '-'}]: ${row.text}`),
  }
}

// ── Scenario runner ────────────────────────────────────────────────────────

type PartResult = {
  idx: number
  offsetMs: number
  durationMs: number
  promptChars: number
  latencyMs: number
  attempts: number
  ok: boolean
  code: string | null
  lines: number
  outputChars: number
  /** Raw model reply for the (synthetic) part, for debugging parse/format issues. */
  rawOutput: string | null
  sentAudioMs: number | null
  /** Result code of every attempt, in order (null = ok). */
  attemptCodes: Array<string | null>
  /** Reply of the final attempt was already valid JSON without repair. */
  strictJson: boolean | null
  /** Reply was not valid JSON but the parser recovered usable rows from it. */
  recovered: boolean
  providers: Array<string | null>
  generationIds: Array<string | null>
  provider: ReturnType<typeof summarizeCalls>
  providerCalls: Array<Record<string, unknown> | null>
}

function strictJsonReply(content: string | null | undefined) {
  if (!content) return null
  // Split-path replies are two JSON documents joined by a newline.
  const docs = content.includes('}\n{') ? content.split(/\n(?=\{)/) : [content]
  return docs.every((doc) => {
    const text = doc.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    try {
      const parsed = JSON.parse(text) as { s?: unknown }
      return Array.isArray(parsed.s) && parsed.s.every((row) => Array.isArray(row) && row.length === 4)
    } catch {
      return false
    }
  })
}

async function transcribeScenario(apiKey: string, pcm: Int16Array, projectName: string) {
  const segmenter = new PcmSegmenter()
  const block = MEETING_SAMPLE_RATE / 4
  const segments = []
  for (let i = 0; i < pcm.length; i += block) segments.push(...segmenter.push(pcm.subarray(i, i + block)))
  const tail = segmenter.flush()
  if (tail) segments.push(tail)

  const stitched: StitchedSegment[] = []
  const roster: RosterSpeaker[] = []
  const parts: PartResult[] = []
  const previousLimit = getAiRuntimeConfig().meeting.previousContextLines
  for (const segment of segments) {
    const previousLines = stitched.slice(-previousLimit).map((row) => ({ label: row.speakerLabel, text: row.text }))
    const prompt = buildTranscriptionPrompt({
      roster,
      previousLines,
      chunkIdx: segment.idx,
      vocabulary: [projectName, ...ENGINE_VOCABULARY],
    })
    const audioBase64 = wavBase64(segment.chunks)
    const firstCall = calls.length
    const started = Date.now()
    let result = await transcribeAudioChunk({ apiKey, audioBase64, prompt, model: STT_MODEL, trimSilence: TRIM })
    let attempts = 1
    const attemptCodes: Array<string | null> = [result.ok ? null : result.code]
    // Mirrors the engine: a failed attempt is retried; attempt >= 2 uses the split path.
    while (!result.ok && attempts < 3) {
      attempts += 1
      result = await transcribeAudioChunk({ apiKey, audioBase64, prompt, model: STT_MODEL, split: attempts >= 2, trimSilence: TRIM })
      attemptCodes.push(result.ok ? null : result.code)
    }
    const latencyMs = Date.now() - started
    const partCalls = await drainCalls(firstCall)
    const sent = (result as { audio?: { sentMs?: number } }).audio?.sentMs
    const strictJson = strictJsonReply(result.content)
    const part: PartResult = {
      idx: segment.idx,
      offsetMs: segment.offsetMs,
      durationMs: segment.durationMs,
      promptChars: prompt.length,
      latencyMs,
      attempts,
      ok: result.ok,
      code: result.ok ? null : result.code,
      lines: 0,
      outputChars: result.content?.length ?? 0,
      rawOutput: result.content ?? null,
      sentAudioMs: typeof sent === 'number' ? sent : null,
      attemptCodes,
      strictJson,
      recovered: strictJson === false && result.ok && Boolean(result.content && parseTranscriptionContent(result.content)),
      providers: partCalls.map((call) => call.provider ?? null),
      generationIds: partCalls.map((call) => call.generationId ?? null),
      provider: summarizeCalls(partCalls),
      providerCalls: partCalls.map((call) => call.usage),
    }
    parts.push(part)
    if (!result.ok) continue
    const rows = stitchChunkSegments({
      response: result.data,
      chunkIdx: segment.idx,
      offsetMs: segment.offsetMs,
      durationMs: segment.durationMs,
      roster,
    })
    for (const row of rows) {
      expect(row.start_ms).toBeGreaterThanOrEqual(segment.offsetMs)
      expect(row.end_ms).toBeLessThanOrEqual(segment.offsetMs + segment.durationMs)
    }
    part.lines = rows.length
    stitched.push(...rows)
    const descriptions = new Map((result.data.speakers ?? []).map((s) => [s.label.trim(), s.description ?? null]))
    for (const label of new Set(rows.map((row) => row.speakerLabel))) {
      if (!roster.some((speaker) => speaker.label === label)) {
        roster.push({ id: `spk-${label}`, label, description: descriptions.get(label) ?? null })
      }
    }
  }
  return { stitched, roster, parts }
}

async function analyze(
  apiKey: string,
  scenario: Scenario,
  stitched: StitchedSegment[],
  roster: RosterSpeaker[],
  forceHierarchical: boolean,
) {
  const lines: AnalysisLine[] = stitched.map((row, i) => ({
    ref: i + 1,
    segmentId: `seg-${i + 1}`,
    speakerLabel: row.speakerLabel,
    startMs: row.start_ms,
    text: row.text,
  }))
  const saved = {
    direct: process.env.AI_MEETING_DIRECT_ANALYSIS_CHARS,
    window: process.env.AI_MEETING_HIERARCHICAL_CHUNK_CHARS,
  }
  if (forceHierarchical) {
    process.env.AI_MEETING_DIRECT_ANALYSIS_CHARS = '500'
    process.env.AI_MEETING_HIERARCHICAL_CHUNK_CHARS = '1400'
  }
  const firstCall = calls.length
  const started = Date.now()
  try {
    const result = await runMeetingAnalysis({
      apiKey,
      title: scenario.title,
      meetingDate: '2026-09-30',
      projectName: scenario.projectName,
      roster: roster.map((speaker) => ({ label: speaker.label, display_name: null })),
      locale: scenario.locale,
      timeZone: 'Asia/Riyadh',
      lines,
      model: ANALYSIS_MODEL,
    })
    const latencyMs = Date.now() - started
    const analysisCalls = await drainCalls(firstCall)
    const base = {
      latencyMs,
      provider: summarizeCalls(analysisCalls),
      providerCalls: analysisCalls.map((call) => ({ title: call.title, requestChars: call.requestChars, usage: call.usage })),
    }
    if (!result.ok) return { ...base, ok: false, code: result.code, strategy: null }
    const clean = result.analysis
    const decisionText = clean.decisions.map((d) => d.text.toLowerCase()).join('\n')
    const actionText = clean.action_items.map((a) => `${a.title} ${a.description ?? ''}`.toLowerCase())
    const segmentIds = new Set(lines.map((line) => line.segmentId))
    const rosterLabels = new Set(roster.map((speaker) => speaker.label))
    return {
      ...base,
      ok: true,
      strategy: result.strategy,
      summary: clean.summary,
      decisions: clean.decisions.map((d) => `${d.certainty}: ${d.text}`),
      actions: clean.action_items.map(
        (a) => `${a.certainty}: ${a.title} | owner=${a.ownerLabel ?? '-'}(${a.owner_certainty}) | due=${a.due_text ?? '-'}`,
      ),
      checks: {
        decisionsMatched: scenario.decisionPatterns.filter((p) => p.test(decisionText)).length,
        decisionsExpected: scenario.decisionPatterns.length,
        actionsMatched: scenario.actionPatterns.filter((p) => actionText.some((text) => p.test(text))).length,
        actionsExpected: scenario.actionPatterns.length,
        invalidRefs: [...clean.decisions, ...clean.action_items].flatMap((item) =>
          item.source_segment_ids.filter((id) => !segmentIds.has(id)),
        ).length,
        invalidOwners: clean.action_items.filter((a) => a.ownerLabel && !rosterLabels.has(a.ownerLabel)).length,
      },
    }
  } finally {
    process.env.AI_MEETING_DIRECT_ANALYSIS_CHARS = saved.direct
    process.env.AI_MEETING_HIERARCHICAL_CHUNK_CHARS = saved.window
    if (saved.direct === undefined) delete process.env.AI_MEETING_DIRECT_ANALYSIS_CHARS
    if (saved.window === undefined) delete process.env.AI_MEETING_HIERARCHICAL_CHUNK_CHARS
  }
}

// ── Test ───────────────────────────────────────────────────────────────────

describe.skipIf(!enabled)('meeting AI benchmark (live OpenRouter)', () => {
  const apiKey = loadApiKey()
  let dir = ''
  const audio = new Map<string, { pcm: Int16Array; utterances: Utterance[] }>()
  const report: Record<string, unknown> = {
    label: LABEL,
    createdAt: new Date().toISOString(),
    model: STT_MODEL,
    analysisModel: ANALYSIS_MODEL,
    sttEndpoint: STT_ENDPOINT,
    trimSilence: TRIM,
    commit: '',
    scenarios: [] as unknown[],
  }

  beforeAll(() => {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the benchmark')
    try {
      report.commit = execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim()
      report.dirty = execSync('git status --porcelain -- netlify src supabase', { stdio: 'pipe' }).toString().trim().length > 0
    } catch {
      report.commit = 'unknown'
    }
    installFetchCapture()
    dir = mkdtempSync(join(tmpdir(), 'hilm-meeting-bench-'))
    for (const scenario of ACTIVE_SCENARIOS) {
      const jobs = scenario.lines.map((line, i) => ({
        voice: line.voice,
        text: line.text,
        ssml: line.pitch ? pitchedSsml(line.text, line.pitch) : null,
        path: join(dir, `${scenario.name}-${i}.wav`),
      }))
      synthesize(dir, jobs)
      const pieces: Int16Array[] = []
      const utterances: Utterance[] = []
      let cursor = 0
      scenario.lines.forEach((line, i) => {
        const pcm = readWavPcm(jobs[i]!.path)
        utterances.push({ voice: speakerKey(line), text: line.text, startMs: samplesToMs(cursor), endMs: samplesToMs(cursor + pcm.length) })
        const gap = new Int16Array(Math.round(((line.pauseAfterMs ?? GAP_MS) / 1000) * MEETING_SAMPLE_RATE))
        pieces.push(pcm, gap)
        cursor += pcm.length + gap.length
      })
      const pcm = new Int16Array(cursor)
      let at = 0
      for (const piece of pieces) {
        pcm.set(piece, at)
        at += piece.length
      }
      addNoise(pcm, scenario.noise)
      audio.set(scenario.name, { pcm, utterances })
    }
  }, 180_000)

  afterAll(() => {
    globalThis.fetch = originalFetch
    if (dir) rmSync(dir, { recursive: true, force: true })
    mkdirSync('benchmarks/meeting-ai', { recursive: true })
    const out = join('benchmarks/meeting-ai', `${LABEL}.json`)
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\n[meeting-benchmark] wrote ${out}`)
  })

  it(
    'calibrates prompt and audio token rates from provider-reported usage',
    async () => {
      // A near-silent clip with an empty roster: OpenRouter reports audio_tokens separately, so
      // prompt_tokens - audio_tokens is the fixed text-prompt cost of a first part.
      const prompt = buildTranscriptionPrompt({ roster: [], previousLines: [], chunkIdx: 0, vocabulary: ['Calibration', ...ENGINE_VOCABULARY] })
      const seconds = 8
      const first = calls.length
      const result = await transcribeAudioChunk({
        apiKey,
        audioBase64: wavBase64([addNoise(new Int16Array(seconds * MEETING_SAMPLE_RATE))]),
        prompt,
        model: STT_MODEL,
      })
      const usage = summarizeCalls(await drainCalls(first))
      const sent = (result as { audio?: { sentMs?: number } }).audio?.sentMs
      const sentMs = typeof sent === 'number' ? sent : seconds * 1000
      report.calibration = {
        promptChars: prompt.length,
        seconds,
        sentMs,
        usage,
        audioTokensPerSecond: sentMs ? round(usage.audioTokens / (sentMs / 1000), 2) : null,
        textPromptTokens: usage.textPromptTokens,
        silenceSegments: result.ok ? result.data.segments.length : -1,
        silenceText: result.ok ? result.data.segments.map((s) => s.text).join(' ') : result.code,
      }
      expect(usage.promptTokens).toBeGreaterThan(0)
    },
    90_000,
  )

  for (const scenario of ACTIVE_SCENARIOS) {
    it(
      `${scenario.name}: transcribes and analyzes with measured provider usage`,
      async () => {
        const { pcm, utterances } = audio.get(scenario.name)!
        const { stitched, roster, parts } = await transcribeScenario(apiKey, pcm, scenario.projectName)
        const quality = measureQuality(scenario, utterances, stitched)
        const direct = ANALYSIS ? await analyze(apiKey, scenario, stitched, roster, false) : null
        const hierarchical = ANALYSIS && scenario.hierarchical ? await analyze(apiKey, scenario, stitched, roster, true) : null
        const stt = summarizeCalls(parts.flatMap((part) => part.providerCalls.map((usage) => ({ title: '', status: 200, requestChars: 0, usage }))))
        const audioSeconds = samplesToMs(pcm.length) / 1000
        ;(report.scenarios as unknown[]).push({
          name: scenario.name,
          audioSeconds: round(audioSeconds, 2),
          parts,
          stt,
          sttPerAudioMinute: {
            promptTokens: round(stt.promptTokens / (audioSeconds / 60), 1),
            completionTokens: round(stt.completionTokens / (audioSeconds / 60), 1),
            totalTokens: round(stt.totalTokens / (audioSeconds / 60), 1),
            costUsd: round(stt.costUsd / (audioSeconds / 60), 6),
          },
          quality,
          analysis: { direct, hierarchical },
        })
        expect(parts.every((part) => part.ok)).toBe(true)
        expect(stitched.length).toBeGreaterThan(0)
      },
      600_000,
    )
  }

  it(
    'noise and silence only: no invented speech',
    async () => {
      // 8 s near-silence, 12 s loud broadband noise, 4 s of clicks, 8 s near-silence.
      const rate = MEETING_SAMPLE_RATE
      const pcm = new Int16Array(32 * rate)
      addNoise(pcm.subarray(0, 8 * rate), 120)
      addNoise(pcm.subarray(8 * rate, 20 * rate), 3500)
      for (let t = 20 * rate; t < 24 * rate; t += Math.round(rate / 3)) {
        for (let k = 0; k < 400 && t + k < pcm.length; k += 1) pcm[t + k] = k % 2 ? 9000 : -9000
      }
      addNoise(pcm.subarray(24 * rate), 120)
      const { stitched, parts } = await transcribeScenario(apiKey, pcm, 'Noise check')
      const stt = summarizeCalls(parts.flatMap((part) => part.providerCalls.map((usage) => ({ title: '', status: 200, requestChars: 0, usage }))))
      report.noise = {
        audioSeconds: 32,
        parts,
        stt,
        lines: stitched.length,
        words: normalizeWords(stitched.map((row) => row.text).join(' ')).length,
        transcript: stitched.map((row) => `${row.speakerLabel} @${(row.start_ms / 1000).toFixed(1)}s: ${row.text}`),
      }
      expect(parts.every((part) => part.ok)).toBe(true)
    },
    120_000,
  )

  it(
    'records which upstream provider/endpoint OpenRouter routed each STT call to',
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000))
      const ids = calls
        .filter((call) => call.title === 'Hilm Meeting Transcription' && call.generationId)
        .map((call) => call.generationId!)
      const tally: Record<string, { calls: number; costUsd: number }> = {}
      const samples: unknown[] = []
      for (const id of ids) {
        const res = await originalFetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        })
        if (!res.ok) continue
        const data = ((await res.json()) as { data?: Record<string, unknown> }).data
        if (!data) continue
        const key = `${String(data.provider_name ?? '?')}`
        tally[key] ??= { calls: 0, costUsd: 0 }
        tally[key].calls += 1
        tally[key].costUsd = round(tally[key].costUsd + num(data.total_cost), 6)
        if (samples.length < 2) samples.push(data)
      }
      report.routing = { lookedUp: ids.length, byProvider: tally, samples }
      expect(ids.length).toBeGreaterThan(0)
    },
    120_000,
  )
})
