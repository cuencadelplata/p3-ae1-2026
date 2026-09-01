// src/models/viaje.model.ts

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
    codigoVerificacion: string;
    qrCode?: string; // QR code como data URL
    fechaCreacion: Date;
}