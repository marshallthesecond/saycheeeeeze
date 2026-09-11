// ⚠ HAND-WRITTEN STAND-IN, not generator output.
//
// `npx supabase gen types` fails on this machine with `spawn UNKNOWN`, and the
// PowerShell `>` redirect truncated this file to zero bytes before the command
// even ran — which is why it had to be rebuilt by hand. Regenerate it properly
// once the CLI works and this header will disappear on its own.
//
// Against the generator's usual output there is one deliberate difference:
// `file_name` and `aspect_ratio` are typed `never` in Insert and Update because
// they are GENERATED ALWAYS ... STORED columns. Postgres rejects any write to
// them at runtime — that is exactly the bug that left the photos table empty on
// 2026-09-01. Typing them `never` turns that into a compile error instead.

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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      blackout_dates: {
        Row: {
          created_at: string
          day: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          day: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          day?: string
          reason?: string | null
        }
        Relationships: []
      }
      booking_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip_hash: string
          succeeded: boolean
        }
        Insert: {
          attempted_at?: string
          id?: number
          ip_hash: string
          succeeded?: boolean
        }
        Update: {
          attempted_at?: string
          id?: number
          ip_hash?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      bookings: {
        Row: {
          addons: Json
          base_price_uzs: number
          client_name: string
          created_at: string
          decided_at: string | null
          deposit_paid_at: string | null
          deposit_required_uzs: number | null
          duration_minutes: number
          ends_at: string | null
          id: string
          ip_hash: string | null
          locale: string
          location_custom: string | null
          location_id: string | null
          notes: string | null
          notified_at: string | null
          notify_channel: string | null
          package_id: string
          package_name: Json
          people_count: number | null
          phone: string | null
          price_uzs: number
          ref: string
          service_slug: string | null
          session_date: string
          source: string | null
          start_time: string
          status: string
          synced_to_sheet: boolean
          telegram_bound_at: string | null
          telegram_chat_id: number | null
          telegram_username: string | null
          updated_at: string
        }
        Insert: {
          addons?: Json
          base_price_uzs: number
          client_name: string
          created_at?: string
          decided_at?: string | null
          deposit_paid_at?: string | null
          deposit_required_uzs?: number | null
          duration_minutes: number
          ends_at?: string | null
          id?: string
          ip_hash?: string | null
          locale?: string
          location_custom?: string | null
          location_id?: string | null
          notes?: string | null
          notified_at?: string | null
          notify_channel?: string | null
          package_id: string
          package_name: Json
          people_count?: number | null
          phone?: string | null
          price_uzs: number
          ref: string
          service_slug?: string | null
          session_date: string
          source?: string | null
          start_time: string
          status?: string
          synced_to_sheet?: boolean
          telegram_bound_at?: string | null
          telegram_chat_id?: number | null
          telegram_username?: string | null
          updated_at?: string
        }
        Update: {
          addons?: Json
          base_price_uzs?: number
          client_name?: string
          created_at?: string
          decided_at?: string | null
          deposit_paid_at?: string | null
          deposit_required_uzs?: number | null
          duration_minutes?: number
          ends_at?: string | null
          id?: string
          ip_hash?: string | null
          locale?: string
          location_custom?: string | null
          location_id?: string | null
          notes?: string | null
          notified_at?: string | null
          notify_channel?: string | null
          package_id?: string
          package_name?: Json
          people_count?: number | null
          phone?: string | null
          price_uzs?: number
          ref?: string
          service_slug?: string | null
          session_date?: string
          source?: string | null
          start_time?: string
          status?: string
          synced_to_sheet?: boolean
          telegram_bound_at?: string | null
          telegram_chat_id?: number | null
          telegram_username?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      galleries: {
        Row: {
          accent_color: string
          bunny_folder: string | null
          client_note: string | null
          cover_path: string | null
          created_at: string
          date_label: string
          description: string
          download_enabled: boolean
          download_tiers: string[]
          expires_at: string | null
          id: string
          is_listed: boolean
          is_published: boolean
          kind: string
          list_cover_path: string | null
          list_label: string | null
          location: string
          photographer_handle: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
          visibility: string
          year: string
        }
        Insert: {
          accent_color?: string
          bunny_folder?: string | null
          client_note?: string | null
          cover_path?: string | null
          created_at?: string
          date_label?: string
          description?: string
          download_enabled?: boolean
          download_tiers?: string[]
          expires_at?: string | null
          id?: string
          is_listed?: boolean
          is_published?: boolean
          kind?: string
          list_cover_path?: string | null
          list_label?: string | null
          location?: string
          photographer_handle?: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
          visibility?: string
          year?: string
        }
        Update: {
          accent_color?: string
          bunny_folder?: string | null
          client_note?: string | null
          cover_path?: string | null
          created_at?: string
          date_label?: string
          description?: string
          download_enabled?: boolean
          download_tiers?: string[]
          expires_at?: string | null
          id?: string
          is_listed?: boolean
          is_published?: boolean
          kind?: string
          list_cover_path?: string | null
          list_label?: string | null
          location?: string
          photographer_handle?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
          visibility?: string
          year?: string
        }
        Relationships: []
      }
      gallery_access: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string | null
          gallery_id: string
          id: string
          label: string
          last_used_at: string | null
          revoked_at: string | null
          use_count: number
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at?: string | null
          gallery_id: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          use_count?: number
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string | null
          gallery_id?: string
          id?: string
          label?: string
          last_used_at?: string | null
          revoked_at?: string | null
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "gallery_access_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_unlock_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip: string | null
          slug: string
          succeeded: boolean
        }
        Insert: {
          attempted_at?: string
          id?: number
          ip?: string | null
          slug: string
          succeeded?: boolean
        }
        Update: {
          attempted_at?: string
          id?: number
          ip?: string | null
          slug?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      packages: {
        Row: {
          accent_color: string
          cover_path: string | null
          created_at: string
          delivery_hours: number
          duration_label: Json
          duration_minutes: number
          edited_max: number
          edited_min: number
          extra_people_block: number | null
          extra_people_price_uzs: number | null
          id: string
          includes: Json
          is_active: boolean
          is_bookable: boolean
          max_people: number | null
          max_people_hard: number | null
          name: Json
          price_uzs: number
          sort_order: number
          tagline: Json
          updated_at: string
        }
        Insert: {
          accent_color?: string
          cover_path?: string | null
          created_at?: string
          delivery_hours?: number
          duration_label?: Json
          duration_minutes: number
          edited_max: number
          edited_min: number
          extra_people_block?: number | null
          extra_people_price_uzs?: number | null
          id: string
          includes?: Json
          is_active?: boolean
          is_bookable?: boolean
          max_people?: number | null
          max_people_hard?: number | null
          name: Json
          price_uzs: number
          sort_order?: number
          tagline?: Json
          updated_at?: string
        }
        Update: {
          accent_color?: string
          cover_path?: string | null
          created_at?: string
          delivery_hours?: number
          duration_label?: Json
          duration_minutes?: number
          edited_max?: number
          edited_min?: number
          extra_people_block?: number | null
          extra_people_price_uzs?: number | null
          id?: string
          includes?: Json
          is_active?: boolean
          is_bookable?: boolean
          max_people?: number | null
          max_people_hard?: number | null
          name?: Json
          price_uzs?: number
          sort_order?: number
          tagline?: Json
          updated_at?: string
        }
        Relationships: []
      }
      photos: {
        Row: {
          alt: string | null
          aspect_ratio: number | null
          attempts: number
          bytes: number | null
          checksum8: string | null
          claimed_at: string | null
          created_at: string
          delivery_bytes: number | null
          share_bytes: number | null
          source_bytes: number | null
          error: string | null
          file_name: string | null
          gallery_id: string
          height: number | null
          id: string
          ladder_rev: number
          sort_order: number
          status: string
          storage_path: string
          taken_at: string | null
          thumbhash: string | null
          variants: Json
          width: number | null
        }
        Insert: {
          alt?: string | null
          aspect_ratio?: never
          attempts?: number
          bytes?: number | null
          checksum8?: string | null
          claimed_at?: string | null
          created_at?: string
          delivery_bytes?: number | null
          share_bytes?: number | null
          source_bytes?: number | null
          error?: string | null
          file_name?: never
          gallery_id: string
          height?: number | null
          id?: string
          ladder_rev?: number
          sort_order?: number
          status?: string
          storage_path: string
          taken_at?: string | null
          thumbhash?: string | null
          variants?: Json
          width?: number | null
        }
        Update: {
          alt?: string | null
          aspect_ratio?: never
          attempts?: number
          bytes?: number | null
          checksum8?: string | null
          claimed_at?: string | null
          created_at?: string
          delivery_bytes?: number | null
          share_bytes?: number | null
          source_bytes?: number | null
          error?: string | null
          file_name?: never
          gallery_id?: string
          height?: number | null
          id?: string
          ladder_rev?: number
          sort_order?: number
          status?: string
          storage_path?: string
          taken_at?: string | null
          thumbhash?: string | null
          variants?: Json
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      expire_stale_holds: { Args: never; Returns: number }
      reset_stale_photo_claims: {
        Args: { older_than?: unknown }
        Returns: number
      }
      unlock_gallery: {
        Args: { p_code: string; p_ip: string; p_slug: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
