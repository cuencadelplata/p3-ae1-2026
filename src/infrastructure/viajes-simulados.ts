import type { ConsultaViajes } from '../application/calificaciones-ports.js';
import type { ResumenViaje } from '../domain/calificaciones.js';

export class ViajesSimulados implements ConsultaViajes {
  private readonly viajes: ResumenViaje[];

  constructor(clienteSimulado = 'cliente-1') {
    this.viajes = [
      { id: 'viaje-1', clienteId: clienteSimulado, conductorId: 'conductor-1', estado: 'COMPLETADO' },
      { id: 'viaje-2', clienteId: clienteSimulado, conductorId: 'conductor-2', estado: 'EN_CURSO' },
      { id: 'viaje-3', clienteId: clienteSimulado, conductorId: 'conductor-1', estado: 'CANCELADO' },
      { id: 'viaje-4', clienteId: `${clienteSimulado}-ajeno`, conductorId: 'conductor-3', estado: 'COMPLETADO' },
      { id: 'viaje-5', clienteId: clienteSimulado, conductorId: 'conductor-2', estado: 'COMPLETADO' }
    ];
  }

  async obtenerViaje(viajeId: string): Promise<ResumenViaje | undefined> {
    const viaje = this.viajes.find((elemento) => elemento.id === viajeId);
    return viaje ? { ...viaje } : undefined;
  }
}