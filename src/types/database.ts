export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Rel = {
  foreignKeyName: string
  columns: string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: string[]
}

type Table<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown>,
  Relationships extends Rel[] = [],
> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: Relationships
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string
          display_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        },
        {
          id: string
          display_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        },
        {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
          updated_at?: string
        }
      >
      user_settings: Table<
        {
          user_id: string
          theme: string
          default_model: string
          notification_prefs: Json
          openrouter_api_key_encrypted: string | null
          has_openrouter_key: boolean
          default_reminder_type: Database['public']['Enums']['reminder_type']
          email_reminders_enabled: boolean
          push_notifications_enabled: boolean
          onboarding_completed: boolean
          default_startup_mode: Database['public']['Enums']['startup_mode']
          created_at: string
          updated_at: string
        },
        {
          user_id: string
          theme?: string
          default_model?: string
          notification_prefs?: Json
          openrouter_api_key_encrypted?: string | null
          has_openrouter_key?: boolean
          default_reminder_type?: Database['public']['Enums']['reminder_type']
          email_reminders_enabled?: boolean
          push_notifications_enabled?: boolean
          onboarding_completed?: boolean
          default_startup_mode?: Database['public']['Enums']['startup_mode']
          created_at?: string
          updated_at?: string
        },
        {
          theme?: string
          default_model?: string
          notification_prefs?: Json
          openrouter_api_key_encrypted?: string | null
          has_openrouter_key?: boolean
          default_reminder_type?: Database['public']['Enums']['reminder_type']
          email_reminders_enabled?: boolean
          push_notifications_enabled?: boolean
          onboarding_completed?: boolean
          default_startup_mode?: Database['public']['Enums']['startup_mode']
          updated_at?: string
        }
      >
      projects: Table<
        {
          id: string
          user_id: string
          name: string
          description: string | null
          icon: string | null
          color: string
          status: Database['public']['Enums']['project_status']
          priority: Database['public']['Enums']['priority']
          completion_pct: number
          health: Database['public']['Enums']['health_status']
          health_explanation: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          name: string
          description?: string | null
          icon?: string | null
          color?: string
          status?: Database['public']['Enums']['project_status']
          priority?: Database['public']['Enums']['priority']
          completion_pct?: number
          health?: Database['public']['Enums']['health_status']
          health_explanation?: string | null
        },
        {
          id?: string
          user_id?: string
          name?: string
          description?: string | null
          icon?: string | null
          color?: string
          status?: Database['public']['Enums']['project_status']
          priority?: Database['public']['Enums']['priority']
          completion_pct?: number
          health?: Database['public']['Enums']['health_status']
          health_explanation?: string | null
        }
      >
      tags: Table<
        {
          id: string
          user_id: string
          name: string
          color: string
          created_at: string
        },
        {
          id?: string
          user_id: string
          name: string
          color?: string
        },
        {
          name?: string
          color?: string
        }
      >
      entity_tags: Table<
        {
          id: string
          user_id: string
          tag_id: string
          entity_type: string
          entity_id: string
          created_at: string
        },
        {
          id?: string
          user_id: string
          tag_id: string
          entity_type: string
          entity_id: string
        },
        {
          tag_id?: string
          entity_type?: string
          entity_id?: string
        }
      >
      tasks: Table<
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
        },
        [
          {
            foreignKeyName: 'tasks_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      >
      subtasks: Table<
        {
          id: string
          user_id: string
          task_id: string
          title: string
          done: boolean
          position: number
          created_at: string
        },
        {
          id?: string
          user_id: string
          task_id: string
          title: string
          done?: boolean
          position?: number
        },
        {
          title?: string
          done?: boolean
          position?: number
        }
      >
      task_dependencies: Table<
        {
          id: string
          user_id: string
          task_id: string
          depends_on_task_id: string
          created_at: string
        },
        {
          id?: string
          user_id: string
          task_id: string
          depends_on_task_id: string
        },
        {
          task_id?: string
          depends_on_task_id?: string
        }
      >
      notes: Table<
        {
          id: string
          user_id: string
          project_id: string | null
          title: string
          body: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id?: string | null
          title: string
          body?: string
        },
        {
          title?: string
          body?: string
          project_id?: string | null
        }
      >
      ideas: Table<
        {
          id: string
          user_id: string
          project_id: string | null
          title: string
          description: string | null
          impact: number
          effort: number
          priority: Database['public']['Enums']['priority']
          status: Database['public']['Enums']['idea_status']
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id?: string | null
          title: string
          description?: string | null
          impact?: number
          effort?: number
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['idea_status']
        },
        {
          project_id?: string | null
          title?: string
          description?: string | null
          impact?: number
          effort?: number
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['idea_status']
        }
      >
      roadmap_items: Table<
        {
          id: string
          user_id: string
          project_id: string
          title: string
          description: string | null
          horizon: Database['public']['Enums']['roadmap_horizon']
          position: number
          starts_at: string | null
          ends_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id: string
          title: string
          description?: string | null
          horizon?: Database['public']['Enums']['roadmap_horizon']
          position?: number
          starts_at?: string | null
          ends_at?: string | null
        },
        {
          title?: string
          description?: string | null
          horizon?: Database['public']['Enums']['roadmap_horizon']
          position?: number
          starts_at?: string | null
          ends_at?: string | null
        }
      >
      releases: Table<
        {
          id: string
          user_id: string
          project_id: string
          version: string
          notes: string | null
          shipped_at: string | null
          created_at: string
        },
        {
          id?: string
          user_id: string
          project_id: string
          version: string
          notes?: string | null
          shipped_at?: string | null
        },
        {
          version?: string
          notes?: string | null
          shipped_at?: string | null
        }
      >
      meetings: Table<
        {
          id: string
          user_id: string
          project_id: string | null
          title: string
          notes: string | null
          held_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id?: string | null
          title: string
          notes?: string | null
          held_at?: string | null
        },
        {
          project_id?: string | null
          title?: string
          notes?: string | null
          held_at?: string | null
        }
      >
      documents: Table<
        {
          id: string
          user_id: string
          project_id: string | null
          title: string
          body: string
          kind: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id?: string | null
          title: string
          body?: string
          kind?: string
        },
        {
          project_id?: string | null
          title?: string
          body?: string
          kind?: string
        }
      >
      daily_logs: Table<
        {
          id: string
          user_id: string
          log_date: string
          worked_on: string | null
          blockers: string | null
          hours: number | null
          wins: string | null
          tomorrow: string | null
          ai_summary: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          log_date: string
          worked_on?: string | null
          blockers?: string | null
          hours?: number | null
          wins?: string | null
          tomorrow?: string | null
          ai_summary?: string | null
        },
        {
          worked_on?: string | null
          blockers?: string | null
          hours?: number | null
          wins?: string | null
          tomorrow?: string | null
          ai_summary?: string | null
        }
      >
      activity_events: Table<
        {
          id: string
          user_id: string
          entity_type: string
          entity_id: string | null
          project_id: string | null
          action: string
          summary: string
          metadata: Json
          created_at: string
        },
        {
          id?: string
          user_id: string
          entity_type: string
          entity_id?: string | null
          project_id?: string | null
          action: string
          summary: string
          metadata?: Json
        },
        {
          summary?: string
          metadata?: Json
        }
      >
      ai_conversations: Table<
        {
          id: string
          user_id: string
          title: string
          agent_id: string
          project_id: string | null
          workspace_id: string | null
          model: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          title?: string
          agent_id?: string
          project_id?: string | null
          workspace_id?: string | null
          model?: string | null
        },
        {
          title?: string
          agent_id?: string
          project_id?: string | null
          workspace_id?: string | null
          model?: string | null
          updated_at?: string
        }
      >
      ai_messages: Table<
        {
          id: string
          user_id: string
          conversation_id: string
          role: string
          content: string
          actions: Json
          model: string | null
          created_at: string
        },
        {
          id?: string
          user_id: string
          conversation_id: string
          role: string
          content: string
          actions?: Json
          model?: string | null
        },
        {
          content?: string
          actions?: Json
        }
      >
      task_reminders: Table<
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
      push_subscriptions: Table<
        {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
          updated_at?: string
        },
        {
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          updated_at?: string
        }
      >
      attachments: Table<
        {
          id: string
          user_id: string
          entity_type: string
          entity_id: string
          storage_path: string
          mime: string | null
          filename: string
          created_at: string
        },
        {
          id?: string
          user_id: string
          entity_type: string
          entity_id: string
          storage_path: string
          mime?: string | null
          filename: string
        },
        {
          filename?: string
          mime?: string | null
        }
      >
      workspaces: Table<
        {
          id: string
          name: string
          slug: string
          description: string | null
          logo_url: string | null
          color: string
          invite_code: string
          owner_id: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          name: string
          slug: string
          description?: string | null
          logo_url?: string | null
          color?: string
          invite_code: string
          owner_id: string
          created_at?: string
          updated_at?: string
        },
        {
          name?: string
          slug?: string
          description?: string | null
          logo_url?: string | null
          color?: string
          invite_code?: string
          owner_id?: string
          updated_at?: string
        }
      >
      workspace_members: Table<
        {
          workspace_id: string
          user_id: string
          role: Database['public']['Enums']['workspace_role']
          joined_at: string
        },
        {
          workspace_id: string
          user_id: string
          role?: Database['public']['Enums']['workspace_role']
          joined_at?: string
        },
        {
          role?: Database['public']['Enums']['workspace_role']
        }
      >
      workspace_projects: Table<
        {
          id: string
          workspace_id: string
          created_by: string
          name: string
          description: string | null
          icon: string | null
          color: string
          status: Database['public']['Enums']['project_status']
          priority: Database['public']['Enums']['priority']
          completion_pct: number
          health: Database['public']['Enums']['health_status']
          created_at: string
          updated_at: string
        },
        {
          id?: string
          workspace_id: string
          created_by: string
          name: string
          description?: string | null
          icon?: string | null
          color?: string
          status?: Database['public']['Enums']['project_status']
          priority?: Database['public']['Enums']['priority']
          completion_pct?: number
          health?: Database['public']['Enums']['health_status']
          created_at?: string
          updated_at?: string
        },
        {
          name?: string
          description?: string | null
          icon?: string | null
          color?: string
          status?: Database['public']['Enums']['project_status']
          priority?: Database['public']['Enums']['priority']
          completion_pct?: number
          health?: Database['public']['Enums']['health_status']
          updated_at?: string
        }
      >
      workspace_tasks: Table<
        {
          id: string
          workspace_id: string
          project_id: string
          created_by: string
          assignee_id: string | null
          title: string
          description: string | null
          priority: Database['public']['Enums']['priority']
          status: Database['public']['Enums']['task_status']
          estimated_hours: number | null
          due_at: string | null
          due_date: string | null
          position: number
          completed_at: string | null
          reminder_type: string | null
          reminder_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          workspace_id: string
          project_id: string
          created_by: string
          assignee_id?: string | null
          title: string
          description?: string | null
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['task_status']
          estimated_hours?: number | null
          due_at?: string | null
          due_date?: string | null
          position?: number
          completed_at?: string | null
          reminder_type?: string | null
          reminder_at?: string | null
          created_at?: string
          updated_at?: string
        },
        {
          project_id?: string
          assignee_id?: string | null
          title?: string
          description?: string | null
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['task_status']
          estimated_hours?: number | null
          due_at?: string | null
          due_date?: string | null
          position?: number
          completed_at?: string | null
          reminder_type?: string | null
          reminder_at?: string | null
          updated_at?: string
        }
      >
      workspace_activity_events: Table<
        {
          id: string
          workspace_id: string
          actor_id: string | null
          event_type: string
          entity_type: string | null
          entity_id: string | null
          summary: string
          payload: Json
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          actor_id?: string | null
          event_type: string
          entity_type?: string | null
          entity_id?: string | null
          summary: string
          payload?: Json
          created_at?: string
        },
        {
          summary?: string
          payload?: Json
        }
      >
      workspace_member_settings: Table<
        {
          workspace_id: string
          user_id: string
          display_name_override: string | null
          avatar_url: string | null
          notification_prefs: Json
          appearance_prefs: Json
          ai_prefs: Json
          created_at: string
          updated_at: string
        },
        {
          workspace_id: string
          user_id: string
          display_name_override?: string | null
          avatar_url?: string | null
          notification_prefs?: Json
          appearance_prefs?: Json
          ai_prefs?: Json
          created_at?: string
          updated_at?: string
        },
        {
          display_name_override?: string | null
          avatar_url?: string | null
          notification_prefs?: Json
          appearance_prefs?: Json
          ai_prefs?: Json
          updated_at?: string
        }
      >
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: {
        Args: { p_name: string; p_description?: string | null; p_color?: string | null }
        Returns: Database['public']['Tables']['workspaces']['Row']
      }
      join_workspace_by_invite: {
        Args: { p_code: string }
        Returns: Database['public']['Tables']['workspaces']['Row']
      }
      regenerate_workspace_invite: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      list_workspace_member_directory: {
        Args: { p_workspace_id: string }
        Returns: {
          user_id: string
          role: Database['public']['Enums']['workspace_role']
          joined_at: string
          display_name: string | null
          avatar_url: string | null
          email: string | null
          display_name_override: string | null
          last_active_at: string | null
        }[]
      }
    }
    Enums: {
      task_status:
        | 'backlog'
        | 'todo'
        | 'in_progress'
        | 'waiting'
        | 'testing'
        | 'done'
        | 'archived'
      project_status: 'active' | 'paused' | 'completed' | 'archived'
      priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
      health_status:
        | 'unengaged'
        | 'started'
        | 'active'
        | 'healthy'
        | 'near_completion'
        | 'blocked'
        | 'stalled'
        | 'warning'
        | 'critical'
      roadmap_horizon: 'now' | 'next' | 'later' | 'future'
      idea_status: 'inbox' | 'exploring' | 'accepted' | 'rejected' | 'converted'
      reminder_type: '5m' | '15m' | '30m' | '1h' | 'same_day_morning' | '1d' | '2d' | '1w' | 'custom'
      notification_channel: 'email' | 'push' | 'in_app'
      workspace_role: 'owner' | 'admin' | 'member' | 'viewer'
      startup_mode: 'personal' | 'workspace'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type Inserts<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type Updates<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
