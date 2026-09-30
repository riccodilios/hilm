#!/usr/bin/env node
/**
 * Runs the live meeting-AI benchmark (real OpenRouter calls, Windows OneCore voices).
 * Usage: npm run bench:meeting-ai -- <label>   → benchmarks/meeting-ai/<label>.json
 */
import { spawnSync } from 'node:child_process'

const label = process.argv[2] || 'run'
const result = spawnSync(
  'npx',
  ['vitest', 'run', 'netlify/functions/_shared/meeting-benchmark.live.test.ts', '--reporter=verbose'],
  { stdio: 'inherit', shell: true, env: { ...process.env, MEETING_BENCHMARK: '1', MEETING_BENCHMARK_LABEL: label } },
)
process.exit(result.status ?? 1)
