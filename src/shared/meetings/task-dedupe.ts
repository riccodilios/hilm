export function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505'
}

/**
 * Create at most one task per action item. The unique index on source_action_item_id is the
 * real guard; this resolves races (double click, two tabs) to the task that won.
 */
export async function createTaskOnce(input: {
  findExisting: () => Promise<string | null>
  create: () => Promise<string>
}): Promise<{ taskId: string; existed: boolean }> {
  const existing = await input.findExisting()
  if (existing) return { taskId: existing, existed: true }
  try {
    return { taskId: await input.create(), existed: false }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    const raced = await input.findExisting()
    if (!raced) throw error
    return { taskId: raced, existed: true }
  }
}
