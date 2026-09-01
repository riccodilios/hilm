import { describe, expect, it } from 'vitest'
import { customizeReportFromPrompt } from '@/shared/reports/engine/aiCustomize'

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
      expect.arrayContaining([
        'tasks_by_status',
        'tasks_by_priority',
        'effort_by_project',
        'completion_trend',
        'project_comparison',
      ]),
    )
  })

  it('selects line and comparison visuals from natural language', () => {
    const { config } = customizeReportFromPrompt(
      'workspace',
      'Show a line graph of created vs completed and a market comparison across projects',
    )
    expect(config.charts?.some((chart) => chart.id === 'completion_trend' && chart.kind === 'line')).toBe(
      true,
    )
    expect(
      config.charts?.some((chart) => chart.id === 'project_comparison' && chart.kind === 'comparison'),
    ).toBe(true)
  })

  it('regenerates chart kinds when the prompt is re-applied without also/keep', () => {
    const first = customizeReportFromPrompt('personal', 'pie chart by priority')
    const second = customizeReportFromPrompt(
      'personal',
      'Use a line chart for the completion trend instead',
      first.config,
    )
    expect(second.config.charts?.some((chart) => chart.id === 'completion_trend' && chart.kind === 'line')).toBe(
      true,
    )
  })
})
