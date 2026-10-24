import { describe, expect, it } from 'vitest'
import { isSafeMeetingAppHref, mapSharedMeeting, SHARE_TOKEN_RE, sha256Hex, sharedMeetingUrl } from './shared-meeting'

const payload = {
  meeting: {
    title: 'مراجعة الإطلاق — Launch review',
    status: 'ready',
    held_at: '2026-10-24T16:01:42Z',
    duration_seconds: 4557,
    language: 'ar',
    participants: ['Sara', 'Omar'],
    summary: 'اتفقنا على موعد الإطلاق. We agreed on the launch date.',
    key_points: ['Launch on Monday'],
    shared_at: '2026-10-24T18:00:00Z',
  },
  speakers: [{ id: 'spk-1', label: 'Speaker 1', display_name: 'Sara', ordinal: 0 }],
  transcript: [
    { id: 't1', speaker_id: 'spk-1', ordinal: 0, start_ms: 0, end_ms: 4000, text: 'خلينا نراجع the dashboard', language: 'ar', languages: ['ar', 'en'] },
    { id: 't2', speaker_id: 'spk-1', ordinal: 10000, start_ms: 4_556_000, end_ms: 4_557_000, text: 'Thanks all', language: 'en', languages: [] },
  ],
  decisions: [{ id: 'd1', text: 'Launch Monday', certainty: 'confirmed', source_segment_ids: ['t1'], ordinal: 0 }],
  action_items: [
    {
      id: 'a1',
      title: 'Send recap',
      description: null,
      owner_speaker_id: 'spk-1',
      owner_certainty: 'confirmed',
      due_text: 'tomorrow',
      due_date: null,
      priority: 'high',
      certainty: 'confirmed',
      source_segment_ids: ['t2'],
      ordinal: 0,
    },
  ],
}

describe('mapSharedMeeting', () => {
  it('maps the public payload for the read-only view, preserving Arabic and English text', () => {
    const detail = mapSharedMeeting(payload)!
    expect(detail.meeting.title).toBe('مراجعة الإطلاق — Launch review')
    expect(detail.transcript.map((segment) => segment.text)).toEqual(['خلينا نراجع the dashboard', 'Thanks all'])
    expect(detail.transcript[1]).toMatchObject({ startMs: 4_556_000, speakerId: 'spk-1' })
    expect(detail.speakers[0]).toMatchObject({ label: 'Speaker 1', displayName: 'Sara' })
    expect(detail.actionItems[0]).toMatchObject({ title: 'Send recap', dueText: 'tomorrow', taskId: null })
  })

  it('never carries private fields, even if a response contained them', () => {
    const detail = mapSharedMeeting({
      ...payload,
      meeting: { ...payload.meeting, description: 'private notes', user_id: 'u1', project_id: 'p1' },
      action_items: [{ ...payload.action_items[0], task_id: 'task-1' }],
    })!
    expect(detail.meeting.description).toBeNull()
    expect(detail.meeting.projectId).toBeNull()
    expect(detail.meeting.createdBy).toBeNull()
    expect(detail.actionItems[0]!.taskId).toBeNull()
    expect(detail.audio).toEqual([])
  })

  it('rejects malformed payloads', () => {
    expect(mapSharedMeeting(null)).toBeNull()
    expect(mapSharedMeeting({ transcript: [] })).toBeNull()
  })
})

describe('share links', () => {
  it('builds the public URL and recognises well-formed tokens only', () => {
    const token = 'a'.repeat(43)
    expect(sharedMeetingUrl('https://hillm.netlify.app/', token)).toBe(`https://hillm.netlify.app/shared/meeting/${token}`)
    expect(SHARE_TOKEN_RE.test(token)).toBe(true)
    expect(SHARE_TOKEN_RE.test('short')).toBe(false)
    expect(SHARE_TOKEN_RE.test(`${'a'.repeat(42)}/`)).toBe(false)
  })

  it('only follows in-app meeting paths after resolving a link', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(isSafeMeetingAppHref(`/personal/projects/${id}/meetings/${id}`)).toBe(true)
    expect(isSafeMeetingAppHref(`/workspace/${id}/projects/${id}/meetings/${id}`)).toBe(true)
    expect(isSafeMeetingAppHref('https://evil.example/personal')).toBe(false)
    expect(isSafeMeetingAppHref('//evil.example')).toBe(false)
    expect(isSafeMeetingAppHref('/personal/mission-control')).toBe(false)
    expect(isSafeMeetingAppHref(null)).toBe(false)
  })

  it('hashes tokens the same way the database does (SHA-256 hex)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
