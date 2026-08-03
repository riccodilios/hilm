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
          ai_tier_id: string
          created_at: string
          updated_at: string
        },
        {
          id: string
          display_name?: string | null
          avatar_url?: string | null
          ai_tier_id?: string
          created_at?: string
          updated_at?: string
        },
        {
          id?: string
          display_name?: string | null
          avatar_url?: string | null
          ai_tier_id?: string
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
          hide_workspace_os: boolean
          hide_personal_os: boolean
          time_format: '12h' | '24h'
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
          hide_workspace_os?: boolean
          hide_personal_os?: boolean
          time_format?: '12h' | '24h'
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
          hide_workspace_os?: boolean
          hide_personal_os?: boolean
          time_format?: '12h' | '24h'
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
          byte_size: number | null
          version: number
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
          byte_size?: number | null
          version?: number
        },
        {
          filename?: string
          mime?: string | null
          byte_size?: number | null
          version?: number
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
          team_id: string | null
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
          team_id?: string | null
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
          team_id?: string | null
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
          department_id: string | null
          team_id: string | null
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
          department_id?: string | null
          team_id?: string | null
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
          department_id?: string | null
          team_id?: string | null
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
          skills: string[]
          department_id: string | null
          availability: Json
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
          skills?: string[]
          department_id?: string | null
          availability?: Json
          created_at?: string
          updated_at?: string
        },
        {
          display_name_override?: string | null
          avatar_url?: string | null
          notification_prefs?: Json
          appearance_prefs?: Json
          ai_prefs?: Json
          skills?: string[]
          department_id?: string | null
          availability?: Json
          updated_at?: string
        }
      >
      workspace_labels: Table<
        {
          id: string
          workspace_id: string
          name: string
          color: string
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          name: string
          color?: string
        },
        { name?: string; color?: string }
      >
      workspace_project_labels: Table<
        {
          id: string
          workspace_id: string
          project_id: string
          label_id: string
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          project_id: string
          label_id: string
        },
        { label_id?: string }
      >
      workspace_attachments: Table<
        {
          id: string
          workspace_id: string
          entity_type: string
          entity_id: string
          storage_path: string
          mime: string | null
          filename: string
          byte_size: number | null
          version: number
          uploaded_by: string
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          entity_type: string
          entity_id: string
          storage_path: string
          mime?: string | null
          filename: string
          byte_size?: number | null
          version?: number
          uploaded_by: string
        },
        { filename?: string; mime?: string | null; byte_size?: number | null; version?: number }
      >
      workspace_departments: Table<
        {
          id: string
          workspace_id: string
          parent_id: string | null
          name: string
          description: string | null
          head_user_id: string | null
          sort_order: number
          created_at: string
          updated_at: string
        },
        {
          id?: string
          workspace_id: string
          parent_id?: string | null
          name: string
          description?: string | null
          head_user_id?: string | null
          sort_order?: number
        },
        {
          parent_id?: string | null
          name?: string
          description?: string | null
          head_user_id?: string | null
          sort_order?: number
          updated_at?: string
        }
      >
      workspace_assignment_events: Table<
        {
          id: string
          workspace_id: string
          task_id: string
          actor_id: string | null
          event_type: string
          from_department_id: string | null
          to_department_id: string | null
          from_team_id: string | null
          to_team_id: string | null
          from_assignee_id: string | null
          to_assignee_id: string | null
          summary: string
          payload: Json
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          task_id: string
          actor_id?: string | null
          event_type: string
          from_department_id?: string | null
          to_department_id?: string | null
          from_team_id?: string | null
          to_team_id?: string | null
          from_assignee_id?: string | null
          to_assignee_id?: string | null
          summary: string
          payload?: Json
          created_at?: string
        },
        {
          summary?: string
          payload?: Json
        }
      >
      workspace_teams: Table<
        {
          id: string
          workspace_id: string
          department_id: string | null
          name: string
          description: string | null
          lead_user_id: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          workspace_id: string
          department_id?: string | null
          name: string
          description?: string | null
          lead_user_id?: string | null
        },
        {
          department_id?: string | null
          name?: string
          description?: string | null
          lead_user_id?: string | null
          updated_at?: string
        }
      >
      workspace_team_members: Table<
        {
          id: string
          workspace_id: string
          team_id: string
          user_id: string
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          team_id: string
          user_id: string
        },
        Record<string, never>
      >
      workspace_crm_integrations: Table<
        {
          id: string
          workspace_id: string
          provider: Database['public']['Enums']['crm_provider']
          status: Database['public']['Enums']['crm_integration_status']
          display_name: string | null
          sync_settings: Json
          credentials_encrypted: string | null
          last_sync_at: string | null
          last_error: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          workspace_id: string
          provider: Database['public']['Enums']['crm_provider']
          status?: Database['public']['Enums']['crm_integration_status']
          display_name?: string | null
          sync_settings?: Json
          credentials_encrypted?: string | null
          created_by?: string | null
        },
        {
          status?: Database['public']['Enums']['crm_integration_status']
          display_name?: string | null
          sync_settings?: Json
          credentials_encrypted?: string | null
          last_sync_at?: string | null
          last_error?: string | null
          updated_at?: string
        }
      >
      workspace_load_balance_runs: Table<
        {
          id: string
          workspace_id: string
          mode: string
          created_by: string
          summary: string | null
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          mode: string
          created_by: string
          summary?: string | null
        },
        { summary?: string | null }
      >
      workspace_load_balance_suggestions: Table<
        {
          id: string
          workspace_id: string
          run_id: string
          task_id: string
          suggested_assignee_id: string | null
          score: number
          rationale: string | null
          mode: string
          applied_at: string | null
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          run_id: string
          task_id: string
          suggested_assignee_id?: string | null
          score?: number
          rationale?: string | null
          mode: string
          applied_at?: string | null
        },
        { applied_at?: string | null; suggested_assignee_id?: string | null; score?: number; rationale?: string | null }
      >
      ai_reports: Table<
        {
          id: string
          user_id: string
          report_type: string
          title: string
          content_html: string
          branding: Json
          created_at: string
        },
        {
          id?: string
          user_id: string
          report_type: string
          title: string
          content_html?: string
          branding?: Json
        },
        { title?: string; content_html?: string; branding?: Json }
      >
      workspace_ai_reports: Table<
        {
          id: string
          workspace_id: string
          created_by: string
          report_type: string
          title: string
          content_html: string
          branding: Json
          created_at: string
        },
        {
          id?: string
          workspace_id: string
          created_by: string
          report_type: string
          title: string
          content_html?: string
          branding?: Json
        },
        { title?: string; content_html?: string; branding?: Json }
      >
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      begin_ai_request: {
        Args: {
          p_request_kind: string
          p_model?: string | null
          p_workspace_id?: string | null
          p_conversation_id?: string | null
          p_idempotency_key?: string | null
          p_fingerprint?: string | null
          p_user_id?: string | null
        }
        Returns: Json
      }
      complete_ai_request: {
        Args: {
          p_event_id: string
          p_status: string
          p_input_tokens?: number
          p_output_tokens?: number
          p_model?: string | null
          p_error_code?: string | null
          p_error_message?: string | null
          p_user_id?: string | null
        }
        Returns: Json
      }
      estimate_ai_cost: {
        Args: {
          p_model: string
          p_input_tokens: number
          p_output_tokens: number
        }
        Returns: number
      }
      get_ai_usage_summary: {
        Args: {
          p_user_id?: string | null
        }
        Returns: Json
      }
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
      crm_provider: 'salesforce' | 'hubspot' | 'zoho' | 'dynamics' | 'custom_rest'
      crm_integration_status: 'disconnected' | 'configured' | 'connected' | 'error' | 'syncing'
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
