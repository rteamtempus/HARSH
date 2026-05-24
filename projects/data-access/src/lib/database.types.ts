export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_log: {
        Row: {
          created_at: string
          error: string | null
          family_id: string
          id: string
          latency_ms: number | null
          member_id: string | null
          parsed_intent: Json | null
          result: Json | null
          surface: string
          transcript: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          family_id: string
          id?: string
          latency_ms?: number | null
          member_id?: string | null
          parsed_intent?: Json | null
          result?: Json | null
          surface: string
          transcript: string
        }
        Update: {
          created_at?: string
          error?: string | null
          family_id?: string
          id?: string
          latency_ms?: number | null
          member_id?: string | null
          parsed_intent?: Json | null
          result?: Json | null
          surface?: string
          transcript?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_log_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_log_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      briefings: {
        Row: {
          audio_path: string | null
          content: Json
          created_at: string
          family_id: string
          generated_at: string
          id: string
          latency_ms: number | null
          model: string | null
          source_data_hash: string | null
          spoken_text: string | null
          type: Database["public"]["Enums"]["briefing_type"]
        }
        Insert: {
          audio_path?: string | null
          content?: Json
          created_at?: string
          family_id: string
          generated_at?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          source_data_hash?: string | null
          spoken_text?: string | null
          type: Database["public"]["Enums"]["briefing_type"]
        }
        Update: {
          audio_path?: string | null
          content?: Json
          created_at?: string
          family_id?: string
          generated_at?: string
          id?: string
          latency_ms?: number | null
          model?: string | null
          source_data_hash?: string | null
          spoken_text?: string | null
          type?: Database["public"]["Enums"]["briefing_type"]
        }
        Relationships: [
          {
            foreignKeyName: "briefings_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_accounts: {
        Row: {
          color: string
          created_at: string
          credentials_encrypted: string | null
          family_id: string
          ics_url: string | null
          id: string
          kind: Database["public"]["Enums"]["calendar_account_kind"]
          last_sync_error: string | null
          last_sync_status: string | null
          last_synced_at: string | null
          member_id: string | null
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          credentials_encrypted?: string | null
          family_id: string
          ics_url?: string | null
          id?: string
          kind: Database["public"]["Enums"]["calendar_account_kind"]
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          member_id?: string | null
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          credentials_encrypted?: string | null
          family_id?: string
          ics_url?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["calendar_account_kind"]
          last_sync_error?: string | null
          last_sync_status?: string | null
          last_synced_at?: string | null
          member_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_accounts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_accounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      display_config: {
        Row: {
          active_view: string
          device_paired_at: string | null
          device_pairing_code: string | null
          family_id: string
          id: string
          layout: Json
          name: string
          updated_at: string
        }
        Insert: {
          active_view?: string
          device_paired_at?: string | null
          device_pairing_code?: string | null
          family_id: string
          id?: string
          layout?: Json
          name?: string
          updated_at?: string
        }
        Update: {
          active_view?: string
          device_paired_at?: string | null
          device_pairing_code?: string | null
          family_id?: string
          id?: string
          layout?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "display_config_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          all_day: boolean
          assignee_profile_id: string | null
          created_at: string
          ends_at: string | null
          external_id: string | null
          family_id: string
          id: string
          location: string | null
          notes: string | null
          owner_member_id: string | null
          source: Database["public"]["Enums"]["event_source"]
          source_account_id: string | null
          starts_at: string
          title: string
        }
        Insert: {
          all_day?: boolean
          assignee_profile_id?: string | null
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          family_id: string
          id?: string
          location?: string | null
          notes?: string | null
          owner_member_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          source_account_id?: string | null
          starts_at: string
          title: string
        }
        Update: {
          all_day?: boolean
          assignee_profile_id?: string | null
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          family_id?: string
          id?: string
          location?: string | null
          notes?: string | null
          owner_member_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          source_account_id?: string | null
          starts_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_assignee_profile_id_fkey"
            columns: ["assignee_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_source_account_id_fkey"
            columns: ["source_account_id"]
            isOneToOne: false
            referencedRelation: "calendar_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          time_zone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          time_zone?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          time_zone?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          avatar_url: string | null
          color: string
          created_at: string
          display_name: string
          family_id: string
          id: string
          invited_email: string | null
          role: Database["public"]["Enums"]["family_member_role"]
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          color?: string
          created_at?: string
          display_name: string
          family_id: string
          id?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["family_member_role"]
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          color?: string
          created_at?: string
          display_name?: string
          family_id?: string
          id?: string
          invited_email?: string | null
          role?: Database["public"]["Enums"]["family_member_role"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      household_facts: {
        Row: {
          category: string | null
          created_at: string
          family_id: string
          id: string
          key: string
          last_updated: string
          source: string | null
          value: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          family_id: string
          id?: string
          key: string
          last_updated?: string
          source?: string | null
          value: string
        }
        Update: {
          category?: string | null
          created_at?: string
          family_id?: string
          id?: string
          key?: string
          last_updated?: string
          source?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_facts_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      list_items: {
        Row: {
          added_at: string
          added_by_member_id: string | null
          assignee_member_id: string | null
          assignee_profile_id: string | null
          checked: boolean
          checked_at: string | null
          deadline: string | null
          energy: Database["public"]["Enums"]["energy_level"] | null
          estimated_effort: Database["public"]["Enums"]["effort_size"] | null
          family_id: string
          how: string | null
          id: string
          lead_time_minutes: number | null
          list_id: string
          nag: Database["public"]["Enums"]["nag_level"]
          notes: string | null
          sort_order: number
          text: string
          when_hint: string | null
          why: string | null
        }
        Insert: {
          added_at?: string
          added_by_member_id?: string | null
          assignee_member_id?: string | null
          assignee_profile_id?: string | null
          checked?: boolean
          checked_at?: string | null
          deadline?: string | null
          energy?: Database["public"]["Enums"]["energy_level"] | null
          estimated_effort?: Database["public"]["Enums"]["effort_size"] | null
          family_id: string
          how?: string | null
          id?: string
          lead_time_minutes?: number | null
          list_id: string
          nag?: Database["public"]["Enums"]["nag_level"]
          notes?: string | null
          sort_order?: number
          text: string
          when_hint?: string | null
          why?: string | null
        }
        Update: {
          added_at?: string
          added_by_member_id?: string | null
          assignee_member_id?: string | null
          assignee_profile_id?: string | null
          checked?: boolean
          checked_at?: string | null
          deadline?: string | null
          energy?: Database["public"]["Enums"]["energy_level"] | null
          estimated_effort?: Database["public"]["Enums"]["effort_size"] | null
          family_id?: string
          how?: string | null
          id?: string
          lead_time_minutes?: number | null
          list_id?: string
          nag?: Database["public"]["Enums"]["nag_level"]
          notes?: string | null
          sort_order?: number
          text?: string
          when_hint?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "list_items_added_by_member_id_fkey"
            columns: ["added_by_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_assignee_member_id_fkey"
            columns: ["assignee_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_assignee_profile_id_fkey"
            columns: ["assignee_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          created_at: string
          family_id: string
          id: string
          kind: Database["public"]["Enums"]["list_kind"]
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          kind?: Database["public"]["Enums"]["list_kind"]
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["list_kind"]
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "lists_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          created_at: string
          created_by_member_id: string | null
          family_id: string
          id: string
          pinned: boolean
        }
        Insert: {
          body: string
          created_at?: string
          created_by_member_id?: string | null
          family_id: string
          id?: string
          pinned?: boolean
        }
        Update: {
          body?: string
          created_at?: string
          created_by_member_id?: string | null
          family_id?: string
          id?: string
          pinned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notes_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          attributes: Json
          color: string
          created_at: string
          family_id: string
          id: string
          kind: Database["public"]["Enums"]["profile_kind"]
          member_id: string | null
          name: string
        }
        Insert: {
          attributes?: Json
          color?: string
          created_at?: string
          family_id: string
          id?: string
          kind?: Database["public"]["Enums"]["profile_kind"]
          member_id?: string | null
          name: string
        }
        Update: {
          attributes?: Json
          color?: string
          created_at?: string
          family_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["profile_kind"]
          member_id?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      releases: {
        Row: {
          created_at: string
          id: string
          notes: Json
          released_at: string
          version: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: Json
          released_at?: string
          version: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: Json
          released_at?: string
          version?: string
        }
        Relationships: []
      }
      routine_history: {
        Row: {
          by_member_id: string | null
          family_id: string
          id: string
          note: string | null
          occurred_at: string
          routine_id: string
          snooze_until: string | null
          status: Database["public"]["Enums"]["routine_history_status"]
        }
        Insert: {
          by_member_id?: string | null
          family_id: string
          id?: string
          note?: string | null
          occurred_at?: string
          routine_id: string
          snooze_until?: string | null
          status: Database["public"]["Enums"]["routine_history_status"]
        }
        Update: {
          by_member_id?: string | null
          family_id?: string
          id?: string
          note?: string | null
          occurred_at?: string
          routine_id?: string
          snooze_until?: string | null
          status?: Database["public"]["Enums"]["routine_history_status"]
        }
        Relationships: [
          {
            foreignKeyName: "routine_history_by_member_id_fkey"
            columns: ["by_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_history_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_history_routine_id_fkey"
            columns: ["routine_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          active: boolean
          cadence_rrule: string | null
          cadence_type: Database["public"]["Enums"]["routine_cadence_type"]
          category: string | null
          created_at: string
          estimated_effort: Database["public"]["Enums"]["effort_size"] | null
          fair_rotation: boolean
          family_id: string
          id: string
          interval_days: number | null
          lead_time_days: number | null
          nag: Database["public"]["Enums"]["nag_level"]
          name: string
          next_due: string | null
          notes: string | null
          owner_member_id: string | null
          owner_profile_id: string | null
          pause_reason: string | null
          pause_until: string | null
        }
        Insert: {
          active?: boolean
          cadence_rrule?: string | null
          cadence_type: Database["public"]["Enums"]["routine_cadence_type"]
          category?: string | null
          created_at?: string
          estimated_effort?: Database["public"]["Enums"]["effort_size"] | null
          fair_rotation?: boolean
          family_id: string
          id?: string
          interval_days?: number | null
          lead_time_days?: number | null
          nag?: Database["public"]["Enums"]["nag_level"]
          name: string
          next_due?: string | null
          notes?: string | null
          owner_member_id?: string | null
          owner_profile_id?: string | null
          pause_reason?: string | null
          pause_until?: string | null
        }
        Update: {
          active?: boolean
          cadence_rrule?: string | null
          cadence_type?: Database["public"]["Enums"]["routine_cadence_type"]
          category?: string | null
          created_at?: string
          estimated_effort?: Database["public"]["Enums"]["effort_size"] | null
          fair_rotation?: boolean
          family_id?: string
          id?: string
          interval_days?: number | null
          lead_time_days?: number | null
          nag?: Database["public"]["Enums"]["nag_level"]
          name?: string
          next_due?: string | null
          notes?: string | null
          owner_member_id?: string | null
          owner_profile_id?: string | null
          pause_reason?: string | null
          pause_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routines_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routines_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routines_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_release_acks: {
        Row: {
          last_popup_shown_on: string | null
          last_version_seen: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          last_popup_shown_on?: string | null
          last_version_seen?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          last_popup_shown_on?: string | null
          last_version_seen?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_release_acks_last_version_seen_fkey"
            columns: ["last_version_seen"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["version"]
          },
        ]
      }
      weekly_context_notes: {
        Row: {
          content: string
          created_at: string
          created_by_member_id: string | null
          expires_at: string
          family_id: string
          id: string
          influences: string[]
          suppress_topics: string[]
          type: Database["public"]["Enums"]["context_note_type"]
        }
        Insert: {
          content: string
          created_at?: string
          created_by_member_id?: string | null
          expires_at: string
          family_id: string
          id?: string
          influences?: string[]
          suppress_topics?: string[]
          type?: Database["public"]["Enums"]["context_note_type"]
        }
        Update: {
          content?: string
          created_at?: string
          created_by_member_id?: string | null
          expires_at?: string
          family_id?: string
          id?: string
          influences?: string[]
          suppress_topics?: string[]
          type?: Database["public"]["Enums"]["context_note_type"]
        }
        Relationships: [
          {
            foreignKeyName: "weekly_context_notes_created_by_member_id_fkey"
            columns: ["created_by_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_context_notes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_releases: { Args: { p_version: string }; Returns: undefined }
      claim_invitations: { Args: never; Returns: number }
      create_family:
        | {
            Args: {
              family_name: string
              members: Json
              owner_display_name: string
            }
            Returns: string
          }
        | {
            Args: {
              family_name: string
              members: Json
              owner_display_name: string
              time_zone?: string
            }
            Returns: string
          }
      current_user_family_ids: { Args: never; Returns: string[] }
      reap_expired_context_notes: { Args: never; Returns: number }
      routine_advance_next_due: {
        Args: {
          p_anchor?: string
          p_explicit_next_due?: string
          p_routine_id: string
        }
        Returns: string
      }
      routine_complete: {
        Args: {
          p_member_id?: string
          p_next_due?: string
          p_note?: string
          p_routine_id: string
        }
        Returns: string
      }
      routine_default_lead_days: {
        Args: { p_routine: Database["public"]["Tables"]["routines"]["Row"] }
        Returns: number
      }
      routine_pause: {
        Args: { p_reason?: string; p_routine_id: string; p_until: string }
        Returns: undefined
      }
      routine_resume: { Args: { p_routine_id: string }; Returns: undefined }
      routine_skip: {
        Args: {
          p_member_id?: string
          p_next_due?: string
          p_note?: string
          p_routine_id: string
        }
        Returns: string
      }
      routine_snooze: {
        Args: {
          p_days?: number
          p_member_id?: string
          p_note?: string
          p_routine_id: string
        }
        Returns: string
      }
      should_show_release_popup: { Args: never; Returns: boolean }
      unread_releases: {
        Args: never
        Returns: {
          created_at: string
          id: string
          notes: Json
          released_at: string
          version: string
        }[]
        SetofOptions: {
          from: "*"
          to: "releases"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      briefing_type: "daily" | "weekly" | "monthly"
      calendar_account_kind: "ics" | "google" | "caldav"
      context_note_type:
        | "emotional"
        | "situational"
        | "privacy_restriction"
        | "celebration"
      effort_size: "xs" | "s" | "m" | "l"
      energy_level: "low" | "medium" | "high"
      event_source: "manual" | "gcal" | "icloud" | "ics" | "caldav" | "voice"
      family_member_role: "owner" | "adult" | "kid"
      list_kind: "grocery" | "todo" | "custom"
      nag_level: "passive" | "surface" | "assertive"
      profile_kind: "child" | "pet" | "dependent" | "other"
      routine_cadence_type: "calendar" | "interval"
      routine_history_status: "completed" | "skipped" | "snoozed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      briefing_type: ["daily", "weekly", "monthly"],
      calendar_account_kind: ["ics", "google", "caldav"],
      context_note_type: [
        "emotional",
        "situational",
        "privacy_restriction",
        "celebration",
      ],
      effort_size: ["xs", "s", "m", "l"],
      energy_level: ["low", "medium", "high"],
      event_source: ["manual", "gcal", "icloud", "ics", "caldav", "voice"],
      family_member_role: ["owner", "adult", "kid"],
      list_kind: ["grocery", "todo", "custom"],
      nag_level: ["passive", "surface", "assertive"],
      profile_kind: ["child", "pet", "dependent", "other"],
      routine_cadence_type: ["calendar", "interval"],
      routine_history_status: ["completed", "skipped", "snoozed"],
    },
  },
} as const
