import { describe, expect, it } from 'vitest'
import { customizeReportFromPrompt } from '@/features/reports/engine/aiCustomize'

describe('customizeReportFromPrompt charts', () => {
  it('adds pie and bar charts when the user asks for graphs', () => {
    const { config, notes } = customizeReportFromPrompt(
      'workspace',
      'Add a pie chart by priority and a bar chart by status for this week',
    )
    expect(config.datePreset).toBe('this_week')
    expect(config.charts?.some((chart) => chart.id === 'tasks_by_priority' && chart.kind === 'pie')).toBe(
      true,
    )
    expect(config.charts?.some((chart) => chart.id === 'tasks_by_status')).toBe(true)
    expect(notes.join(' ')).toMatch(/Charts included/i)
  })

  it('includes the full chart set for a broad visualization request', () => {
    const { config } = customizeReportFromPrompt(
      'personal',
      'Please include charts and graphs in the report',
    )
    expect(config.charts?.map((chart) => chart.id)).toEqual(
      expect.arrayContaining(['tasks_by_status', 'tasks_by_priority', 'effort_by_project']),
    )
  })
})
