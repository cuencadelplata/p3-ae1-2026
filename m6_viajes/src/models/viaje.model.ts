// src/models/viaje.model.ts
// Este archivo define el modelo de datos para los viajes, incluyendo la interfaz Viaje y el enum EstadoViaje. La interfaz Viaje representa un viaje con sus propiedades, mientras que el enum EstadoViaje define los posibles estados de un viaje.
export enum EstadoViaje {
    SOLICITADO = 'SOLICITADO',
    ASIGNADO = 'ASIGNADO',
    CONDUCTOR_EN_CAMINO = 'CONDUCTOR_EN_CAMINO',
    ARRIBADO = 'ARRIBADO', 
    EN_CURSO = 'EN_CURSO',
    COMPLETADO = 'COMPLETADO',
    CANCELADO = 'CANCELADO'
}

export interface Viaje {
    id: string;
    clienteId: string;
    conductorId?: string;
    estado: EstadoViaje;
    origen: string;
    destino: string;
    codigoVerificacion: string | null;
    qrCode: string | null;
    qrExpiresAt: Date | null;
    fechaCreacion: Date;
}