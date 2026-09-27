import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { MeetingOs } from '../types'

/** A recorded part waiting to be uploaded. Survives reloads, crashes and offline periods. */
export type QueuedSegment = {
  key: string
  os: MeetingOs
  meetingId: string
  idx: number
  storagePath: string
  offsetMs: number
  durationMs: number
  wav: Blob
  attempts: number
  createdAt: number
  lastError?: string | null
}

interface MeetingQueueDb extends DBSchema {
  segments: {
    key: string
    value: QueuedSegment
    indexes: { by_meeting: string }
  }
}

const DB_NAME = 'hilm-meeting-recorder'
let dbPromise: Promise<IDBPDatabase<MeetingQueueDb>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<MeetingQueueDb>(DB_NAME, 1, {
      upgrade(database) {
        const store = database.createObjectStore('segments', { keyPath: 'key' })
        store.createIndex('by_meeting', 'meetingId')
      },
    })
  }
  return dbPromise
}

export function queueKey(os: MeetingOs, meetingId: string, idx: number) {
  return `${os}:${meetingId}:${idx}`
}

export function isQueueSupported() {
  return typeof indexedDB !== 'undefined'
}

export async function enqueueSegment(segment: Omit<QueuedSegment, 'key' | 'attempts' | 'createdAt'>) {
  const item: QueuedSegment = {
    ...segment,
    key: queueKey(segment.os, segment.meetingId, segment.idx),
    attempts: 0,
    createdAt: Date.now(),
  }
  await (await db()).put('segments', item)
  return item
}

export async function listQueuedSegments() {
  const all = await (await db()).getAll('segments')
  return all.sort((a, b) => a.createdAt - b.createdAt || a.idx - b.idx)
}

export async function countQueuedForMeeting(meetingId: string) {
  return (await db()).countFromIndex('segments', 'by_meeting', meetingId)
}

export async function updateQueuedSegment(item: QueuedSegment) {
  await (await db()).put('segments', item)
}

export async function removeQueuedSegment(key: string) {
  await (await db()).delete('segments', key)
}

export async function removeQueuedForMeeting(meetingId: string) {
  const database = await db()
  const keys = await database.getAllKeysFromIndex('segments', 'by_meeting', meetingId)
  await Promise.all(keys.map((key) => database.delete('segments', key)))
}
