export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      reservas: {
        Row: {
          actualizado_en: string | null;
          cliente_id: string;
          creado_en: string | null;
          criterio_asignacion: string | null;
          destino: string;
          estado: Database['public']['Enums']['estado_reserva'] | null;
          fecha_hora_programada: string;
          id: string;
          id_solicitud: string | null;
          moneda: string | null;
          origen: string;
          tarifa_estimada: number | null;
          vehiculo: Database['public']['Enums']['tipo_vehiculo'];
        };
        Insert: {
          actualizado_en?: string | null;
          cliente_id: string;
          creado_en?: string | null;
          criterio_asignacion?: string | null;
          destino: string;
          estado?: Database['public']['Enums']['estado_reserva'] | null;
          fecha_hora_programada: string;
          id?: string;
          id_solicitud?: string | null;
          moneda?: string | null;
          origen: string;
          tarifa_estimada?: number | null;
          vehiculo: Database['public']['Enums']['tipo_vehiculo'];
        };
        Update: {
          actualizado_en?: string | null;
          cliente_id?: string;
          creado_en?: string | null;
          criterio_asignacion?: string | null;
          destino?: string;
          estado?: Database['public']['Enums']['estado_reserva'] | null;
          fecha_hora_programada?: string;
          id?: string;
          id_solicitud?: string | null;
          moneda?: string | null;
          origen?: string;
          tarifa_estimada?: number | null;
          vehiculo?: Database['public']['Enums']['tipo_vehiculo'];
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      estado_reserva:
        | 'PROGRAMADA'
        | 'ACTIVANDO'
        | 'ACTIVADA'
        | 'CANCELADA'
        | 'FALLIDA';
      tipo_vehiculo: 'AUTO' | 'MOTO';
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type ReservaRow = Database['public']['Tables']['reservas']['Row'];
export type ReservaInsert = Database['public']['Tables']['reservas']['Insert'];
export type ReservaUpdate = Database['public']['Tables']['reservas']['Update'];
