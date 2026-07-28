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
> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: Rel[]
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
          created_at?: string
          updated_at?: string
        },
        {
          theme?: string
          default_model?: string
          notification_prefs?: Json
          openrouter_api_key_encrypted?: string | null
          has_openrouter_key?: boolean
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
          project_id: string | null
          title: string
          description: string | null
          priority: Database['public']['Enums']['priority']
          status: Database['public']['Enums']['task_status']
          estimated_hours: number | null
          actual_hours: number | null
          due_at: string | null
          reminder_at: string | null
          position: number
          completed_at: string | null
          created_at: string
          updated_at: string
        },
        {
          id?: string
          user_id: string
          project_id?: string | null
          title: string
          description?: string | null
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['task_status']
          estimated_hours?: number | null
          actual_hours?: number | null
          due_at?: string | null
          reminder_at?: string | null
          position?: number
          completed_at?: string | null
        },
        {
          id?: string
          user_id?: string
          project_id?: string | null
          title?: string
          description?: string | null
          priority?: Database['public']['Enums']['priority']
          status?: Database['public']['Enums']['task_status']
          estimated_hours?: number | null
          actual_hours?: number | null
          due_at?: string | null
          reminder_at?: string | null
          position?: number
          completed_at?: string | null
        }
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
          model?: string | null
        },
        {
          title?: string
          agent_id?: string
          project_id?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
      health_status: 'healthy' | 'warning' | 'blocked' | 'critical'
      roadmap_horizon: 'now' | 'next' | 'later' | 'future'
      idea_status: 'inbox' | 'exploring' | 'accepted' | 'rejected' | 'converted'
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
