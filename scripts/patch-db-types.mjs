import fs from 'node:fs'

const path = 'src/types/database.ts'
let s = fs.readFileSync(path, 'utf8')

const start = s.indexOf('      tasks: Table<')
const end = s.indexOf('      subtasks: Table<')
if (start < 0 || end < 0) throw new Error('tasks block not found')

const tasksBlock = `      tasks: Table<
        {
          id: string
          user_id: string
          project_id: string
          title: string
          description: string | null
          priority: Database['public']['Enums']['priority']
          status: Database['public']['Enums']['task_status']
          estimated_hours: number | null
          actual_hours: number | null
          due_at: string | null
          due_date: string | null
          due_time: string | null
          reminder_at: string | null
          reminder_datetime: string | null
          reminder_type: string | null
          notification_sent: boolean
          position: number
          completed_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id: string
          title: string
          description?: string | null
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['task_status']
          estimated_hours?: number | null
          actual_hours?: number | null
          due_at?: string | null
          due_date?: string | null
          due_time?: string | null
          reminder_at?: string | null
          reminder_datetime?: string | null
          reminder_type?: string | null
          notification_sent?: boolean
          position?: number
          completed_at?: string | null
        },
        {
          id?: string
          user_id?: string
          project_id?: string
          title?: string
          description?: string | null
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['task_status']
          estimated_hours?: number | null
          actual_hours?: number | null
          due_at?: string | null
          due_date?: string | null
          due_time?: string | null
          reminder_at?: string | null
          reminder_datetime?: string | null
          reminder_type?: string | null
          notification_sent?: boolean
          position?: number
          completed_at?: string | null
        }
      >
`
s = s.slice(0, start) + tasksBlock + s.slice(end)

if (!s.includes('task_reminders: Table')) {
  const attach = '      attachments: Table<'
  const idx = s.indexOf(attach)
  const extra = `      task_reminders: Table<
        {
          id: string
          user_id: string
          task_id: string
          project_id: string
          remind_at: string
          reminder_type: Database['public']['Enums']['reminder_type']
          channels: Database['public']['Enums']['notification_channel'][]
          notification_sent: boolean
          sent_at: string | null
          metadata: Json
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          task_id: string
          project_id: string
          remind_at: string
          reminder_type?: Database['public']['Enums']['reminder_type']
          channels?: Database['public']['Enums']['notification_channel'][]
          notification_sent?: boolean
          sent_at?: string | null
          metadata?: Json
        },
        {
          remind_at?: string
          reminder_type?: Database['public']['Enums']['reminder_type']
          channels?: Database['public']['Enums']['notification_channel'][]
          notification_sent?: boolean
          sent_at?: string | null
          metadata?: Json
        }
      >
      notifications: Table<
        {
          id: string
          user_id: string
          channel: Database['public']['Enums']['notification_channel']
          type: string
          title: string
          body: string | null
          entity_type: string | null
          entity_id: string | null
          project_id: string | null
          href: string | null
          read_at: string | null
          metadata: Json
          created_at: string
        },
        {
          id?: string
          user_id: string
          channel?: Database['public']['Enums']['notification_channel']
          type: string
          title: string
          body?: string | null
          entity_type?: string | null
          entity_id?: string | null
          project_id?: string | null
          href?: string | null
          read_at?: string | null
          metadata?: Json
        },
        {
          read_at?: string | null
          title?: string
          body?: string | null
          metadata?: Json
        }
      >
      project_notification_prefs: Table<
        {
          id: string
          user_id: string
          project_id: string
          email_reminders: boolean
          push_notifications: boolean
          in_app_notifications: boolean
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id: string
          email_reminders?: boolean
          push_notifications?: boolean
          in_app_notifications?: boolean
        },
        {
          email_reminders?: boolean
          push_notifications?: boolean
          in_app_notifications?: boolean
        }
      >
`
  s = s.slice(0, idx) + extra + s.slice(idx)
}

if (!s.includes('reminder_type:')) {
  s = s.replace(
    "idea_status: 'inbox' | 'exploring' | 'accepted' | 'rejected' | 'converted'",
    "idea_status: 'inbox' | 'exploring' | 'accepted' | 'rejected' | 'converted'\n      reminder_type: '5m' | '15m' | '30m' | '1h' | 'same_day_morning' | '1d' | '2d' | '1w' | 'custom'\n      notification_channel: 'email' | 'push' | 'in_app'",
  )
}

if (!s.includes('email_reminders_enabled')) {
  s = s.replace(
    'has_openrouter_key: boolean\n          created_at: string\n          updated_at: string\n        },\n        Insert: {\n          user_id: string',
    'has_openrouter_key: boolean\n          default_reminder_type: Database[\'public\'][\'Enums\'][\'reminder_type\']\n          email_reminders_enabled: boolean\n          push_notifications_enabled: boolean\n          created_at: string\n          updated_at: string\n        },\n        Insert: {\n          user_id: string',
  )
  s = s.replace(
    'has_openrouter_key?: boolean\n          created_at?: string\n          updated_at?: string\n        },\n        Update: {\n          theme?: string',
    'has_openrouter_key?: boolean\n          default_reminder_type?: Database[\'public\'][\'Enums\'][\'reminder_type\']\n          email_reminders_enabled?: boolean\n          push_notifications_enabled?: boolean\n          created_at?: string\n          updated_at?: string\n        },\n        Update: {\n          theme?: string',
  )
  s = s.replace(
    'has_openrouter_key?: boolean\n          updated_at?: string\n        }\n      >\n      projects:',
    'has_openrouter_key?: boolean\n          default_reminder_type?: Database[\'public\'][\'Enums\'][\'reminder_type\']\n          email_reminders_enabled?: boolean\n          push_notifications_enabled?: boolean\n          updated_at?: string\n        }\n      >\n      projects:',
  )
}

fs.writeFileSync(path, s)
console.log('ok')
