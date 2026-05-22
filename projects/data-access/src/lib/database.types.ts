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
          created_at: string
          ends_at: string | null
          external_id: string | null
          family_id: string
          id: string
          location: string | null
          notes: string | null
          owner_member_id: string | null
          source: Database["public"]["Enums"]["event_source"]
          starts_at: string
          title: string
        }
        Insert: {
          all_day?: boolean
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          family_id: string
          id?: string
          location?: string | null
          notes?: string | null
          owner_member_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          starts_at: string
          title: string
        }
        Update: {
          all_day?: boolean
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          family_id?: string
          id?: string
          location?: string | null
          notes?: string | null
          owner_member_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          starts_at?: string
          title?: string
        }
        Relationships: [
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
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
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
      list_items: {
        Row: {
          added_at: string
          added_by_member_id: string | null
          checked: boolean
          checked_at: string | null
          family_id: string
          id: string
          list_id: string
          sort_order: number
          text: string
        }
        Insert: {
          added_at?: string
          added_by_member_id?: string | null
          checked?: boolean
          checked_at?: string | null
          family_id: string
          id?: string
          list_id: string
          sort_order?: number
          text: string
        }
        Update: {
          added_at?: string
          added_by_member_id?: string | null
          checked?: boolean
          checked_at?: string | null
          family_id?: string
          id?: string
          list_id?: string
          sort_order?: number
          text?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_family_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      event_source: "manual" | "gcal" | "voice"
      family_member_role: "owner" | "adult" | "kid"
      list_kind: "grocery" | "todo" | "custom"
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
      event_source: ["manual", "gcal", "voice"],
      family_member_role: ["owner", "adult", "kid"],
      list_kind: ["grocery", "todo", "custom"],
    },
  },
} as const
