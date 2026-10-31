import type { Queryable } from '../storage/lifecycle.ts'

export type AlertRule = {
  key: string
  metric: string
  scope: string
  comparison: 'gte' | 'lte'
  warn_value: number | null
  crit_value: number | null
  limit_key: string | null
  cooldown_hours: number
  notify: boolean
  enabled: boolean
  description: string
}

export type Evaluation = { level: 'warning' | 'critical' | null; value: number; threshold: number | null }

/**
 * Compares a measured value with a rule. With a limit the value is converted to a percentage of
 * that limit first. Missing data never raises or resolves an alert (callers skip it).
 */
export function evaluateRule(rule: Pick<AlertRule, 'comparison' | 'warn_value' | 'crit_value'>, raw: number, limit?: number | null): Evaluation {
  const value = limit != null && limit > 0 ? (raw / limit) * 100 : raw
  const hit = (threshold: number | null) =>
    threshold != null && (rule.comparison === 'lte' ? value <= threshold : value >= threshold)
  if (hit(rule.crit_value)) return { level: 'critical', value, threshold: rule.crit_value }
  if (hit(rule.warn_value)) return { level: 'warning', value, threshold: rule.warn_value }
  return { level: null, value, threshold: null }
}

export type OpenAlert = { id: string; rule_key: string; level: 'warning' | 'critical'; last_notified_at: string | null }

export type AlertDecision =
  | { action: 'open'; level: 'warning' | 'critical'; notify: boolean }
  | { action: 'escalate'; level: 'critical'; notify: boolean }
  | { action: 'renotify' }
  | { action: 'resolve'; notify: boolean }
  | { action: 'none' }

/** Dedupe, cooldown and resolution: at most one open alert per rule. */
export function decideAlert(rule: Pick<AlertRule, 'cooldown_hours' | 'notify'>, evaluation: Evaluation, open: OpenAlert | null, now: number): AlertDecision {
  if (!evaluation.level) return open ? { action: 'resolve', notify: rule.notify } : { action: 'none' }
  if (!open) return { action: 'open', level: evaluation.level, notify: rule.notify }
  if (evaluation.level === 'critical' && open.level === 'warning') return { action: 'escalate', level: 'critical', notify: rule.notify }
  const last = open.last_notified_at ? Date.parse(open.last_notified_at) : 0
  if (rule.notify && now - last >= rule.cooldown_hours * 3_600_000) return { action: 'renotify' }
  return { action: 'none' }
}

export type AlertNotice = { ruleKey: string; level: 'warning' | 'critical' | 'resolved'; message: string; value: number }

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1))

/** Evaluates every enabled rule against the latest metrics and updates private.ops_alerts. */
export async function evaluateAlerts(db: Queryable, now = Date.now()): Promise<AlertNotice[]> {
  const rules = (await db.query<AlertRule>(`select * from private.ops_alert_rules where enabled`)).rows
  if (!rules.length) return []
  const latest = (
    await db.query<{ metric: string; scope: string; value: string | null; collected_at: string }>(
      `select distinct on (metric, scope) metric, scope, value, collected_at
       from private.ops_metric_snapshots
       where collected_at > now() - interval '3 days' and value is not null
       order by metric, scope, collected_at desc`,
    )
  ).rows
  const values = new Map(latest.map((r) => [`${r.metric}|${r.scope}`, Number(r.value)]))
  const collectors = (
    await db.query<{ collector: string; age: string | null }>(
      `select collector, extract(epoch from now() - coalesce(last_success_at, last_attempt_at)) / 60 as age
       from private.ops_collector_state where collector in ('metrics', 'lifecycle')`,
    )
  ).rows
  for (const c of collectors) {
    if (c.age == null) continue
    values.set(c.collector === 'metrics' ? 'ops.collector_age_minutes|global' : 'ops.lifecycle_age_minutes|global', Number(c.age))
  }

  const limits = new Map(
    (await db.query<{ key: string; limit_value: string | null }>(`select key, limit_value from private.ops_limits`)).rows.map((r) => [
      r.key,
      r.limit_value == null ? null : Number(r.limit_value),
    ]),
  )
  const open = new Map(
    (await db.query<OpenAlert>(`select id::text, rule_key, level, last_notified_at from private.ops_alerts where resolved_at is null`)).rows.map(
      (a) => [a.rule_key, a],
    ),
  )

  const notices: AlertNotice[] = []
  for (const rule of rules) {
    const raw = values.get(`${rule.metric}|${rule.scope}`)
    if (raw === undefined || Number.isNaN(raw)) continue
    const limit = rule.limit_key ? limits.get(rule.limit_key) : null
    if (rule.limit_key && !(limit && limit > 0)) continue
    const evaluation = evaluateRule(
      { comparison: rule.comparison, warn_value: rule.warn_value == null ? null : Number(rule.warn_value), crit_value: rule.crit_value == null ? null : Number(rule.crit_value) },
      raw,
      limit,
    )
    const current = open.get(rule.key) ?? null
    const decision = decideAlert({ cooldown_hours: Number(rule.cooldown_hours), notify: rule.notify }, evaluation, current, now)
    const unit = rule.limit_key ? '%' : ''
    const message = `${rule.description}: ${fmt(evaluation.value)}${unit} (threshold ${evaluation.threshold == null ? '-' : fmt(Number(evaluation.threshold)) + unit})`

    if (decision.action === 'open') {
      await db.query(
        `insert into private.ops_alerts (rule_key, level, value, threshold, message, last_notified_at)
         values ($1, $2, $3, $4, $5, case when $6 then now() else null end)`,
        [rule.key, decision.level, evaluation.value, evaluation.threshold, message, decision.notify],
      )
      if (decision.notify) notices.push({ ruleKey: rule.key, level: decision.level, message, value: evaluation.value })
    } else if (decision.action === 'escalate') {
      await db.query(
        `update private.ops_alerts set level = 'critical', value = $2, threshold = $3, message = $4,
           last_notified_at = case when $5 then now() else last_notified_at end where id = $1`,
        [current!.id, evaluation.value, evaluation.threshold, message, decision.notify],
      )
      if (decision.notify) notices.push({ ruleKey: rule.key, level: 'critical', message, value: evaluation.value })
    } else if (decision.action === 'renotify') {
      await db.query(`update private.ops_alerts set value = $2, message = $3, last_notified_at = now() where id = $1`, [
        current!.id,
        evaluation.value,
        message,
      ])
      notices.push({ ruleKey: rule.key, level: current!.level, message, value: evaluation.value })
    } else if (decision.action === 'resolve') {
      await db.query(
        `update private.ops_alerts set resolved_at = now(), resolution_notified_at = case when $2 then now() else null end where id = $1`,
        [current!.id, decision.notify],
      )
      if (decision.notify) {
        notices.push({ ruleKey: rule.key, level: 'resolved', message: `${rule.description}: back to normal (${fmt(evaluation.value)}${unit})`, value: evaluation.value })
      }
    } else if (current) {
      await db.query(`update private.ops_alerts set value = $2 where id = $1`, [current.id, evaluation.value])
    }
  }
  return notices
}
