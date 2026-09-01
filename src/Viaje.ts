export type ViajeEstado = 'pendiente' | 'en_curso' | 'finalizado' | 'cancelado';

export interface ViajeTransicion {
  from: ViajeEstado;
  to: ViajeEstado;
  timestamp: Date;
  detalle?: string;
}

export interface FinalizarViajeInput {
  tiempoMinutos: number;
  distanciaKm: number;
  horaFin: Date;
  metodoPago: string;
}

export interface CrearViajeInput {
  id: string;
  clienteId: string;
  conductorId: string;
  estado: ViajeEstado;
  tarifaBase: number;
  tarifaPorKm: number;
  tarifaPorMinuto: number;
  inicio: Date;
  horaFin?: Date;
  tiempoMinutos?: number;
  distanciaKm?: number;
  metodoPago?: string;
  total?: number;
}

export class Viaje {
  id: string;
  clienteId: string;
  conductorId: string;
  estado: ViajeEstado;
  tarifaBase: number;
  tarifaPorKm: number;
  tarifaPorMinuto: number;
  inicio: Date;
  horaFin?: Date;
  tiempoMinutos?: number;
  distanciaKm?: number;
  metodoPago?: string;
  total?: number;
  historialTransiciones: ViajeTransicion[];

  constructor(data: CrearViajeInput) {
    this.id = data.id;
    this.clienteId = data.clienteId;
    this.conductorId = data.conductorId;
    this.estado = data.estado;
    this.tarifaBase = data.tarifaBase;
    this.tarifaPorKm = data.tarifaPorKm;
    this.tarifaPorMinuto = data.tarifaPorMinuto;
    this.inicio = data.inicio;
    this.horaFin = data.horaFin;
    this.tiempoMinutos = data.tiempoMinutos;
    this.distanciaKm = data.distanciaKm;
    this.metodoPago = data.metodoPago;
    this.total = data.total;
    this.historialTransiciones = [];
  }

  private registrarTransicion(from: ViajeEstado, to: ViajeEstado, detalle?: string): void {
    this.historialTransiciones = [
      ...this.historialTransiciones,
      {
        from,
        to,
        timestamp: new Date(),
        detalle,
      },
    ];
  }

  finalizar(data: FinalizarViajeInput): void {
    if (this.estado === 'finalizado') {
      throw new Error('No se puede finalizar un viaje ya finalizado');
    }

    if (this.estado !== 'en_curso' && this.estado !== 'pendiente') {
      throw new Error(`No se puede finalizar un viaje en estado ${this.estado}`);
    }

    this.tiempoMinutos = data.tiempoMinutos;
    this.distanciaKm = data.distanciaKm;
    this.horaFin = data.horaFin;
    this.metodoPago = data.metodoPago;
    this.total = this.tarifaBase + this.distanciaKm * this.tarifaPorKm + this.tiempoMinutos * this.tarifaPorMinuto;

    const estadoAnterior = this.estado;
    this.estado = 'finalizado';
    this.registrarTransicion(estadoAnterior, this.estado, 'Finalización del viaje');
  }
}
