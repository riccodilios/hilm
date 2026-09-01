/** Lazy personal registry bootstrap — no static import of personal actions. */
export async function ensurePersonalAiRegistry() {
  const { ensurePersonalAiRegistry: ensure } = await import('@/features/ai/registry/personal-bootstrap')
  ensure()
}

/** @deprecated Prefer personal-bootstrap on Personal OS pages. */
export async function ensureAiRegistry() {
  await ensurePersonalAiRegistry()
}
