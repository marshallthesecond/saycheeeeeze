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
      account_members: {
        Row: {
          account_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          default_locale: string
          display_name: string
          id: string
          plan: string
          status: string
          storage_prefix: string
          storage_quota_bytes: number | null
          storage_used_bytes: number
          storage_zone: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          default_locale?: string
          display_name: string
          id?: string
          plan?: string
          status?: string
          storage_prefix?: string
          storage_quota_bytes?: number | null
          storage_used_bytes?: number
          storage_zone?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          default_locale?: string
          display_name?: string
          id?: string
          plan?: string
          status?: string
          storage_prefix?: string
          storage_quota_bytes?: number | null
          storage_used_bytes?: number
          storage_zone?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      blackout_dates: {
        Row: {
          account_id: string
          created_at: string
          day: string
          reason: string | null
        }
        Insert: {
          account_id?: string
          created_at?: string
          day: string
          reason?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          day?: string
          reason?: string | null
        }
        Relationships: []
      }
      booking_attempts: {
        Row: {
          account_id: string
          attempted_at: string
          id: number
          ip_hash: string
          succeeded: boolean
        }
        Insert: {
          account_id?: string
          attempted_at?: string
          id?: number
          ip_hash: string
          succeeded?: boolean
        }
        Update: {
          account_id?: string
          attempted_at?: string
          id?: number
          ip_hash?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      bookings: {
        Row: {
          account_id: string
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
          account_id?: string
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
          account_id?: string
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
          account_id: string
          bunny_folder: string | null
          client_note: string | null
          cover_path: string | null
          created_at: string
          created_by: string | null
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
          account_id?: string
          bunny_folder?: string | null
          client_note?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
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
          account_id?: string
          bunny_folder?: string | null
          client_note?: string | null
          cover_path?: string | null
          created_at?: string
          created_by?: string | null
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
      jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: number
          kind: string
          max_attempts: number
          payload: Json
          run_after: string
          status: string
          updated_at: string
          worker: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: never
          kind: string
          max_attempts?: number
          payload?: Json
          run_after?: string
          status?: string
          updated_at?: string
          worker?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: never
          kind?: string
          max_attempts?: number
          payload?: Json
          run_after?: string
          status?: string
          updated_at?: string
          worker?: string | null
        }
        Relationships: []
      }
      packages: {
        Row: {
          accent_color: string
          account_id: string
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
          account_id?: string
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
          account_id?: string
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
          account_id: string
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
          upload_id: string | null
          variants: Json
          width: number | null
        }
        Insert: {
          account_id?: string
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
          upload_id?: string | null
          variants?: Json
          width?: number | null
        }
        Update: {
          account_id?: string
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
          upload_id?: string | null
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
          {
            foreignKeyName: "photos_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_usernames: {
        Row: {
          username: string
        }
        Insert: {
          username: string
        }
        Update: {
          username?: string
        }
        Relationships: []
      }
      upload_batches: {
        Row: {
          account_id: string
          cancelled_count: number
          created_at: string
          created_by: string | null
          failed_count: number
          file_count: number
          finished_at: string | null
          gallery_id: string
          had_cover: boolean | null
          id: string
          ready_count: number
          settled_at: string | null
          skipped_count: number
          status: string
          total_bytes: number
          updated_at: string
        }
        Insert: {
          account_id: string
          cancelled_count?: number
          created_at?: string
          created_by?: string | null
          failed_count?: number
          file_count: number
          finished_at?: string | null
          gallery_id: string
          had_cover?: boolean | null
          id?: string
          ready_count?: number
          settled_at?: string | null
          skipped_count?: number
          status?: string
          total_bytes: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          cancelled_count?: number
          created_at?: string
          created_by?: string | null
          failed_count?: number
          file_count?: number
          finished_at?: string | null
          gallery_id?: string
          had_cover?: boolean | null
          id?: string
          ready_count?: number
          settled_at?: string | null
          skipped_count?: number
          status?: string
          total_bytes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_batches_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          account_id: string
          attempts: number
          batch_id: string
          bytes_received: number
          content_type: string
          created_at: string
          error: string | null
          error_detail: string | null
          finished_at: string | null
          gallery_id: string
          id: string
          original_name: string
          photo_id: string
          received_at: string | null
          sha256: string | null
          size_bytes: number
          sort_order: number
          status: string
          storage_path: string
          ticket_expires_at: string | null
          ticket_hash: string | null
          updated_at: string
          worker: string | null
        }
        Insert: {
          account_id: string
          attempts?: number
          batch_id: string
          bytes_received?: number
          content_type: string
          created_at?: string
          error?: string | null
          error_detail?: string | null
          finished_at?: string | null
          gallery_id: string
          id?: string
          original_name: string
          photo_id?: string
          received_at?: string | null
          sha256?: string | null
          size_bytes: number
          sort_order?: number
          status?: string
          storage_path: string
          ticket_expires_at?: string | null
          ticket_hash?: string | null
          updated_at?: string
          worker?: string | null
        }
        Update: {
          account_id?: string
          attempts?: number
          batch_id?: string
          bytes_received?: number
          content_type?: string
          created_at?: string
          error?: string | null
          error_detail?: string | null
          finished_at?: string | null
          gallery_id?: string
          id?: string
          original_name?: string
          photo_id?: string
          received_at?: string | null
          sha256?: string | null
          size_bytes?: number
          sort_order?: number
          status?: string
          storage_path?: string
          ticket_expires_at?: string | null
          ticket_hash?: string | null
          updated_at?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "uploads_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uploads_gallery_id_fkey"
            columns: ["gallery_id"]
            isOneToOne: false
            referencedRelation: "galleries"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          accepting_uploads: boolean
          backup_at: string | null
          backup_bytes: number | null
          backup_error: string | null
          backup_tables: number | null
          last_seen_at: string
          name: string
          started_at: string
          upload_url: string | null
          version: string
        }
        Insert: {
          accepting_uploads?: boolean
          backup_at?: string | null
          backup_bytes?: number | null
          backup_error?: string | null
          backup_tables?: number | null
          last_seen_at?: string
          name: string
          started_at?: string
          upload_url?: string | null
          version?: string
        }
        Update: {
          accepting_uploads?: boolean
          backup_at?: string | null
          backup_bytes?: number | null
          backup_error?: string | null
          backup_tables?: number | null
          last_seen_at?: string
          name?: string
          started_at?: string
          upload_url?: string | null
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      expire_stale_holds: { Args: never; Returns: number }
      my_account_ids: { Args: never; Returns: string[] }
      reset_stale_photo_claims: {
        Args: { older_than?: unknown }
        Returns: number
      }
      studio_cancel_uploads: {
        Args: { p_batch_id: string; p_upload_ids?: string[] }
        Returns: number
      }
      studio_create_gallery: {
        Args: {
          p_account_id: string
          p_category?: string
          p_date_label?: string
          p_kind: string
          p_location?: string
          p_passkey?: string
          p_passkey_label?: string
          p_slug: string
          p_title: string
        }
        Returns: string
      }
      studio_create_passkey: {
        Args: {
          p_code: string
          p_expires_at?: string
          p_gallery_id: string
          p_label?: string
        }
        Returns: string
      }
      studio_create_upload_batch: {
        Args: { p_files: Json; p_gallery_id: string }
        Returns: Json
      }
      studio_delete_gallery: {
        Args: { p_gallery_id: string }
        Returns: undefined
      }
      studio_delete_photos: {
        Args: { p_gallery_id: string; p_photo_ids: string[] }
        Returns: Json
      }
      studio_renew_upload_tickets: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      studio_retry_cleanup: {
        Args: never
        Returns: number
      }
      studio_retry_upload: {
        Args: { p_upload_id: string }
        Returns: Json
      }
      studio_set_cover: {
        Args: { p_gallery_id: string; p_photo_id?: string }
        Returns: undefined
      }
      studio_storage_cleanup: {
        Args: never
        Returns: Json
      }
      unlock_gallery: {
        Args: { p_code: string; p_ip: string; p_slug: string }
        Returns: string
      }
      upload_door: {
        Args: never
        Returns: { name: string; upload_url: string }[]
      }
      worker_backup_tables: {
        Args: never
        Returns: {
          approx_rows: number
          auth_user_columns: string[]
          columns: string[]
          depends_on: string[]
          generated: string[]
          primary_key: string[]
          table_name: string
        }[]
      }
      worker_backup_users: {
        Args: never
        Returns: { created_at: string; email: string; id: string }[]
      }
      worker_claim_job: {
        Args: { p_kinds: string[]; p_name: string }
        Returns: Database["public"]["Tables"]["jobs"]["Row"][]
      }
      worker_complete_upload: {
        Args: { p_name: string; p_photo: Json; p_stored_bytes: number; p_upload_id: string }
        Returns: string
      }
      worker_finish_job: {
        Args: { p_error?: string; p_job_id: number; p_name: string; p_ok: boolean; p_retry_in?: number }
        Returns: string
      }
      worker_heartbeat: {
        Args: { p_accepting: boolean; p_name: string; p_upload_url: string; p_version: string }
        Returns: undefined
      }
      worker_job_heartbeat: {
        Args: { p_job_id: number; p_name: string }
        Returns: boolean
      }
      worker_set_photo_order: {
        Args: { p_gallery_id: string; p_photo_ids: string[] }
        Returns: number
      }
      worker_settle_batch: {
        Args: { p_batch_id: string }
        Returns: boolean
      }
      worker_start: {
        Args: { p_name: string }
        Returns: number
      }
      worker_upload_received: {
        Args: { p_name: string; p_sha256: string; p_upload_id: string }
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
