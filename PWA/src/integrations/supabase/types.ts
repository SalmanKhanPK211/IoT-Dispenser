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
  public: {
    Tables: {
      alerts: {
        Row: {
          acknowledged: boolean
          created_at: string
          device_id: string
          id: number
          level_pct: number | null
          message: string
          type: string
        }
        Insert: {
          acknowledged?: boolean
          created_at?: string
          device_id: string
          id?: never
          level_pct?: number | null
          message: string
          type: string
        }
        Update: {
          acknowledged?: boolean
          created_at?: string
          device_id?: string
          id?: never
          level_pct?: number | null
          message?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_commands: {
        Row: {
          command: string
          created_at: string
          device_id: string
          executed_at: string | null
          expires_at: string
          id: number
          payload: Json | null
          status: string
        }
        Insert: {
          command: string
          created_at?: string
          device_id: string
          executed_at?: string | null
          expires_at?: string
          id?: never
          payload?: Json | null
          status?: string
        }
        Update: {
          command?: string
          created_at?: string
          device_id?: string
          executed_at?: string | null
          expires_at?: string
          id?: never
          payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          device_token: string
          firmware_version: string | null
          id: string
          last_seen: string | null
          low_level_pct: number
          measured_height_in: number | null
          name: string
          owner_id: string | null
          sensor_offset_in: number
          tank_height_in: number | null
          total_liters_reset_at: string | null
        }
        Insert: {
          created_at?: string
          device_token?: string
          firmware_version?: string | null
          id?: string
          last_seen?: string | null
          low_level_pct?: number
          measured_height_in?: number | null
          name?: string
          owner_id?: string | null
          sensor_offset_in?: number
          tank_height_in?: number | null
          total_liters_reset_at?: string | null
        }
        Update: {
          created_at?: string
          device_token?: string
          firmware_version?: string | null
          id?: string
          last_seen?: string | null
          low_level_pct?: number
          measured_height_in?: number | null
          name?: string
          owner_id?: string | null
          sensor_offset_in?: number
          tank_height_in?: number | null
          total_liters_reset_at?: string | null
        }
        Relationships: []
      }
      readings: {
        Row: {
          created_at: string
          device_id: string
          flow_lpm: number | null
          id: number
          level_in: number | null
          level_pct: number | null
          temp_c: number | null
          total_liters: number | null
        }
        Insert: {
          created_at?: string
          device_id: string
          flow_lpm?: number | null
          id?: never
          level_in?: number | null
          level_pct?: number | null
          temp_c?: number | null
          total_liters?: number | null
        }
        Update: {
          created_at?: string
          device_id?: string
          flow_lpm?: number | null
          id?: never
          level_in?: number | null
          level_pct?: number | null
          temp_c?: number | null
          total_liters?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_sessions: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string
          id: string
          measured_height_in: number | null
          status: string
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at?: string
          id?: string
          measured_height_in?: number | null
          status?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string
          id?: string
          measured_height_in?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setup_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      device_status: {
        Row: {
          firmware_version: string | null
          id: string | null
          last_seen: string | null
          low_level_pct: number | null
          name: string | null
          owner_id: string | null
          status: string | null
          tank_height_in: number | null
          total_liters_reset_at: string | null
        }
        Insert: {
          firmware_version?: string | null
          id?: string | null
          last_seen?: string | null
          low_level_pct?: number | null
          name?: string | null
          owner_id?: string | null
          status?: never
          tank_height_in?: number | null
          total_liters_reset_at?: string | null
        }
        Update: {
          firmware_version?: string | null
          id?: string | null
          last_seen?: string | null
          low_level_pct?: number | null
          name?: string | null
          owner_id?: string | null
          status?: never
          tank_height_in?: number | null
          total_liters_reset_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ack_command: {
        Args: {
          p_command_id: number
          p_device_id: string
          p_device_token: string
          p_status: string
        }
        Returns: undefined
      }
      confirm_counter_reset: {
        Args: { p_device_id: string; p_device_token: string }
        Returns: undefined
      }
      fetch_pending_commands: {
        Args: { p_device_id: string; p_device_token: string }
        Returns: {
          command: string
          created_at: string
          device_id: string
          executed_at: string | null
          expires_at: string
          id: number
          payload: Json | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "device_commands"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_device_config: {
        Args: { p_device_id: string; p_device_token: string }
        Returns: {
          low_level_pct: number
          sensor_offset_in: number
          tank_height_in: number
        }[]
      }
      get_device_token: { Args: { p_device_id: string }; Returns: string }
      ingest_reading: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_firmware?: string
          p_flow_lpm: number
          p_level_in: number
          p_level_pct: number
          p_temp_c: number
          p_total_liters: number
        }
        Returns: undefined
      }
      pair_device: {
        Args: { p_device_id: string; p_name?: string }
        Returns: {
          device_token: string
          id: string
        }[]
      }
      publish_setup_reading: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_height_in: number
          p_setup_id: string
        }
        Returns: undefined
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
