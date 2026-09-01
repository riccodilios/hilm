#!/usr/bin/env node
/**
 * Simulates a future COMPANY_BUILD extraction: starting from workspace-os,
 * follows static imports and fails if Personal OS domain code enters the closure.
 *
 * See ARCHITECTURE.md § Extraction simulation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

/** Personal OS domain roots — must never appear in workspace extraction closure. */
const PERSONAL_DOMAIN_PREFIXES = [
  'src/features/tasks/',
  'src/features/projects/',
  'src/features/home/',
  'src/features/notes/',
  'src/features/ideas/',
  'src/features/daily-log/',
  'src/features/search/',
  'src/features/activity/',
  'src/features/notifications/',
  'src/features/announcements/',
  'src/features/landing/',
  'src/features/scaffold/',
  'src/features/personal/',
  'src/features/mission-control/MissionControlPage.tsx',
  'src/features/reports/PersonalReportsPage.tsx',
  'src/features/reports/personal-api.ts',
  'src/features/tasks/email/',
]

/** Personal-only files inside otherwise-shared trees. */
const PERSONAL_ONLY_FILES = new Set([
  'src/features/ai/registry/personal.ts',
  'src/features/ai/PersonalAiPage.tsx',
  'src/features/ai/AiPage.tsx',
  'src/features/ai/lib/use-personal-preview-directory.ts',
  'src/features/ai/lib/use-preview-directory.ts',
  'src/features/ai/registry/bootstrap.ts',
  'src/features/ai/registry/personal-bootstrap.ts',
  'src/features/command-palette/PersonalCommandPalette.tsx',
  'src/features/command-palette/CommandPalette.tsx',
  'src/features/activity/record.ts',
])

/** Allowed AI infrastructure under features/ai for company build (prefix match). */
const COMPANY_AI_PREFIXES = [
  'src/features/ai/agents',
  'src/features/ai/api',
  'src/features/ai/AiMarkdown',
  'src/features/ai/components/',
  'src/features/ai/lib/',
  'src/features/ai/registry/index',
  'src/features/ai/registry/schemas',
  'src/features/ai/registry/types',
  'src/features/ai/registry/bootstrap.ts',
]

/** Documented bridges — warn in default mode; fail with --strict. */
const DOCUMENTED_BRIDGES = new Set([
  'src/features/settings/SettingsPage.tsx',
  'src/features/settings/api.ts',
])

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
/** When true, follow dynamic import() edges (stricter; off by default). */
const FOLLOW_DYNAMIC = process.argv.includes('--include-dynamic')

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function relPosix(file) {
  return relative(ROOT, file).replace(/\\/g, '/')
}

function tryResolve(base, spec) {
  const exts = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts']
  for (const ext of exts) {
    const candidate = base + ext
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith('@/')) {
    return tryResolve(join(SRC, spec.slice(2)), '')
  }
  if (spec.startsWith('.')) {
    return tryResolve(resolve(dirname(fromFile), spec), '')
  }
  return null
}

function extractSpecs(content) {
  const specs = []
  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1]
    if (spec.startsWith('.') || spec.startsWith('@/')) specs.push(spec)
  }
  if (FOLLOW_DYNAMIC) {
    for (const match of content.matchAll(DYNAMIC_IMPORT_RE)) {
      const spec = match[1]
      if (spec.startsWith('.') || spec.startsWith('@/')) specs.push(spec)
    }
  }
  return specs
}

function isPersonalDomain(rel) {
  if (PERSONAL_ONLY_FILES.has(rel)) return true
  return PERSONAL_DOMAIN_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

function isAllowedAiInfra(rel) {
  if (!rel.startsWith('src/features/ai/')) return false
  return COMPANY_AI_PREFIXES.some((prefix) => rel.startsWith(prefix) || rel === prefix)
}

function classifyViolation(rel) {
  if (isPersonalDomain(rel)) {
    return { rel, kind: 'personal-domain' }
  }
  if (rel.startsWith('src/features/ai/') && !isAllowedAiInfra(rel)) {
    return { rel, kind: 'ai-personal-leak' }
  }
  if (DOCUMENTED_BRIDGES.has(rel)) {
    return { rel, kind: 'documented-bridge' }
  }
  return null
}

const entryFiles = walk(join(SRC, 'features/workspace-os'))
const visited = new Set()
const queue = [...entryFiles]
const violations = []
const warnings = []

while (queue.length) {
  const file = queue.pop()
  const rel = relPosix(file)
  if (visited.has(rel)) continue
  visited.add(rel)

  const hit = classifyViolation(rel)
  if (hit?.kind === 'documented-bridge') {
    warnings.push({ from: rel, target: rel, kind: hit.kind })
    continue
  }
  if (hit) {
    violations.push({ from: rel, target: rel, kind: hit.kind })
    continue
  }

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  for (const spec of extractSpecs(content)) {
    const resolved = resolveSpec(file, spec)
    if (!resolved) continue
    const targetRel = relPosix(resolved)
    if (visited.has(targetRel)) continue

    const targetHit = classifyViolation(targetRel)
    if (targetHit?.kind === 'documented-bridge') {
      warnings.push({ from: rel, target: targetRel, import: spec, kind: targetHit.kind })
      queue.push(resolved)
      continue
    }
    if (targetHit) {
      violations.push({ from: rel, target: targetRel, import: spec, kind: targetHit.kind })
      continue
    }
    queue.push(resolved)
  }
}

console.log(`simulate:extraction — workspace closure: ${visited.size} files`)

if (warnings.length) {
  console.log(`\n${warnings.length} documented bridge(s) (resolve at real extraction time):\n`)
  for (const w of warnings) {
    console.log(`  ${w.from}`)
    if (w.import) console.log(`    → ${w.import}`)
    console.log(`    target: ${w.target}\n`)
  }
}

if (violations.length === 0) {
  console.log('simulate:extraction — PASS (no Personal OS domain code in workspace closure)')
  process.exit(warnings.length && process.argv.includes('--strict') ? 1 : 0)
}

console.log(`\nsimulate:extraction — FAIL (${violations.length} violation(s)):\n`)
for (const v of violations) {
  console.log(`  ${v.from}`)
  if (v.import) console.log(`    imports: ${v.import}`)
  console.log(`    reached: ${v.target} [${v.kind}]\n`)
}
process.exit(1)
