export type Queryable = {
  query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: R[] }>
}

/** A claimed reminder that was never marked sent (crashed run) becomes claimable again after this. */
export const REMINDER_CLAIM_TTL_SECONDS = 300

/**
 * Atomically claims up to `limit` due personal reminders. Concurrent runs skip rows another run
 * holds or has claimed, so a reminder is processed by one run only.
 */
export async function claimDueReminders(db: Queryable, windowEnd: string, limit = 100): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `with due as (
       select r.id from public.task_reminders r
       where r.notification_sent = false
         and r.remind_at <= $1::timestamptz
         and (r.claimed_at is null or r.claimed_at < now() - make_interval(secs => $3))
       order by r.remind_at asc
       limit $2
       for update skip locked
     )
     update public.task_reminders r set claimed_at = now()
     from due where r.id = due.id
     returning r.id`,
    [windowEnd, limit, REMINDER_CLAIM_TTL_SECONDS],
  )
  return rows.map((row) => row.id)
}
