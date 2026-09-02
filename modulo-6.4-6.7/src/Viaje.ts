export type ViajeEstado = 'solicitado' | 'asignado' | 'en curso' | 'completado' | 'cancelado';

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
  total: number;
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
  motivoCancelacion?: string;
  cargoCancelacion?: number;
}

export interface CancelarPorClienteInput {
  motivo: string;
  cargo?: number;
}

export interface CancelarPorConductorInput {
  motivo: string;
}

export interface RetornoDespacho {
  reabrirDespacho: boolean;
  clienteRetornado: boolean;
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
  motivoCancelacion?: string;
  cargoCancelacion?: number;
  motivoCancelacionConductor?: string;
  retornoDespacho?: RetornoDespacho;
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
    this.motivoCancelacion = data.motivoCancelacion;
    this.cargoCancelacion = data.cargoCancelacion;
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
    if (this.estado === 'completado') {
      throw new Error('No se puede finalizar un viaje ya finalizado');
    }

    if (this.estado !== 'en curso' && this.estado !== 'asignado') {
      throw new Error(`No se puede finalizar un viaje en estado ${this.estado}`);
    }

    this.tiempoMinutos = data.tiempoMinutos;
    this.distanciaKm = data.distanciaKm;
    this.horaFin = data.horaFin;
    this.metodoPago = data.metodoPago;
    this.total = data.total;

    const estadoAnterior = this.estado;
    this.estado = 'completado';
    this.registrarTransicion(estadoAnterior, this.estado, 'Finalización del viaje');
  }

  cancelarPorCliente(data: CancelarPorClienteInput): void {
    if (this.estado === 'cancelado') {
      throw new Error('No se puede cancelar un viaje ya cancelado');
    }

    if (this.estado === 'completado') {
      throw new Error('No se puede cancelar un viaje ya finalizado');
    }

    if (!data.motivo || data.motivo.trim().length === 0) {
      throw new Error('El motivo de cancelación es obligatorio');
    }

    const motivo = data.motivo.trim();
    const estadoAnterior = this.estado;
    this.estado = 'cancelado';
    this.motivoCancelacion = motivo;
    this.cargoCancelacion = data.cargo ?? 0;
    this.registrarTransicion(
      estadoAnterior,
      this.estado,
      `Cancelación por cliente: ${motivo}`,
    );
  }

  cancelarPorConductor(data: CancelarPorConductorInput): void {
    if (this.estado === 'cancelado') {
      throw new Error('No se puede cancelar un viaje ya cancelado');
    }

    if (this.estado === 'completado') {
      throw new Error('No se puede cancelar un viaje ya finalizado');
    }

    if (!data.motivo || data.motivo.trim().length === 0) {
      throw new Error('El motivo de cancelación es obligatorio');
    }

    const motivo = data.motivo.trim();
    const estadoAnterior = this.estado;
    this.estado = 'cancelado';
    this.motivoCancelacionConductor = motivo;
    this.retornoDespacho = { reabrirDespacho: true, clienteRetornado: true };
    this.registrarTransicion(
      estadoAnterior,
      this.estado,
      `Cancelación por conductor: ${motivo}`,
    );
  }
}
