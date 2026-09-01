#!/usr/bin/env node
/**
 * Enforces Personal / Workspace OS import boundaries.
 * See ARCHITECTURE.md. Set BOUNDARY_FAIL=1 (default after Phase 4) to exit non-zero.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')

const PERSONAL_FEATURES = new Set([
  'tasks',
  'projects',
  'home',
  'notes',
  'ideas',
  'daily-log',
  'search',
  'activity',
  'notifications',
  'announcements',
  'landing',
  'scaffold',
  'settings',
  'mission-control',
  'reports',
  'ai',
])

const WORKSPACE_FORBIDDEN = new Set([
  'tasks',
  'projects',
  'home',
  'notes',
  'ideas',
  'daily-log',
  'search',
  'activity',
  'mission-control',
  'reports',
  'settings',
])

const BRIDGE_FILES = new Set([
  'src/features/personal/PersonalWorkspacesPage.tsx',
  'src/features/onboarding/OnboardingPage.tsx',
  'src/features/auth/startup.ts',
])

const WORKSPACE_BRIDGE_FILES = new Set([
  'src/features/workspace-os/pages/WorkspacePersonalSettingsPage.tsx',
])

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"](@\/[^'"]+)['"]/g

function walk(dir, out = []) {
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

function classifyPersonalFile(rel) {
  const m = rel.match(/^src\/features\/([^/]+)\//)
  if (!m) return null
  const feature = m[1]
  if (feature === 'workspace-os' || feature === 'auth' || feature === 'personal') return null
  if (!PERSONAL_FEATURES.has(feature)) return null
  return feature
}

function checkFile(file) {
  const rel = relPosix(file)
  const content = readFileSync(file, 'utf8')
  const violations = []

  for (const match of content.matchAll(IMPORT_RE)) {
    const imp = match[1]
    if (!imp.startsWith('@/features/')) continue
    const parts = imp.slice('@/features/'.length).split('/')
    const targetFeature = parts[0]

    const personalFeature = classifyPersonalFile(rel)
    if (personalFeature && targetFeature === 'workspace-os' && !BRIDGE_FILES.has(rel)) {
      violations.push({
        file: rel,
        import: imp,
        rule: `Personal feature "${personalFeature}" must not import workspace-os`,
      })
    }

    if (rel.startsWith('src/features/workspace-os/') && WORKSPACE_FORBIDDEN.has(targetFeature)) {
      if (WORKSPACE_BRIDGE_FILES.has(rel)) continue
      violations.push({
        file: rel,
        import: imp,
        rule: `workspace-os must not import personal feature "${targetFeature}"`,
      })
    }

    if (rel.startsWith('src/shared/') && targetFeature !== 'auth') {
      const forbiddenShared = ['workspace-os', ...WORKSPACE_FORBIDDEN]
      if (forbiddenShared.includes(targetFeature)) {
        violations.push({
          file: rel,
          import: imp,
          rule: `shared/ must not import features/${targetFeature}`,
        })
      }
    }
  }

  return violations
}

const files = walk(SRC)
const all = files.flatMap(checkFile)

if (all.length === 0) {
  console.log('check:boundaries — no violations')
  process.exit(0)
}

console.log(`check:boundaries — ${all.length} violation(s):\n`)
for (const v of all) {
  console.log(`  ${v.file}`)
  console.log(`    ${v.import}`)
  console.log(`    → ${v.rule}\n`)
}

const fail = process.env.BOUNDARY_FAIL === '1' || process.argv.includes('--fail')
if (fail) {
  process.exit(1)
}
console.log('(warn-only — set BOUNDARY_FAIL=1 or pass --fail to exit non-zero)')
