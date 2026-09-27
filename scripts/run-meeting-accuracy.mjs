#!/usr/bin/env node
/** Runs the live meeting transcription accuracy test (real OpenRouter calls, Windows speech voices). */
import { spawnSync } from 'node:child_process'

const result = spawnSync(
  'npx',
  ['vitest', 'run', 'netlify/functions/_shared/meeting-accuracy.live.test.ts', '--reporter=verbose'],
  { stdio: 'inherit', shell: true, env: { ...process.env, MEETING_ACCURACY: '1' } },
)
process.exit(result.status ?? 1)
