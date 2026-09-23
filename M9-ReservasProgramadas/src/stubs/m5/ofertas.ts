import { randomUUID } from 'node:crypto';

export type Decision = 'ACEPTAR' | 'RECHAZAR';
export type RespuestaSimulada = Decision | 'SIN_RESPUESTA' | 'MANUAL';
export interface Oferta {
  id: string;
  reservaId: string;
  rondaId: string;
  choferId: string;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'VENCIDA' | 'CANCELADA';
  venceEn: string;
}

// Simulador local: los temporizadores representan respuestas, no conductores reales.
export class Ofertas {
  private readonly registros = new Map<string, Oferta>();
  private readonly resolver = new Map<string, (estado: Oferta['estado']) => void>();

  public listar(reservaId: string): Oferta[] {
    return [...this.registros.values()]
      .filter((o) => o.reservaId === reservaId)
      .map((o) => ({ ...o }));
  }

  public abrir(
    reservaId: string,
    rondaId: string,
    choferId: string,
    respuesta: RespuestaSimulada,
    plazoMs: number,
    demoraMs: number,
  ): Promise<Oferta> {
    const oferta: Oferta = {
      id: randomUUID(),
      reservaId,
      rondaId,
      choferId,
      estado: 'PENDIENTE',
      venceEn: new Date(Date.now() + plazoMs).toISOString(),
    };
    this.registros.set(oferta.id, oferta);
    return new Promise((resolve) => {
      let respuestaTimer: ReturnType<typeof setTimeout> | undefined;
      const vencimiento = setTimeout(() => finalizar('VENCIDA'), plazoMs);
      const finalizar = (estado: Oferta['estado']) => {
        if (oferta.estado !== 'PENDIENTE') return;
        oferta.estado = estado;
        clearTimeout(vencimiento);
        clearTimeout(respuestaTimer);
        this.resolver.delete(oferta.id);
        resolve({ ...oferta });
      };
      this.resolver.set(oferta.id, finalizar);
      if (respuesta === 'ACEPTAR' || respuesta === 'RECHAZAR') {
        respuestaTimer = setTimeout(() => this.responder(oferta.id, choferId, respuesta), demoraMs);
      }
    });
  }

  public responder(id: string, choferId: string, decision: Decision): Oferta | null {
    const oferta = this.registros.get(id);
    if (!oferta || oferta.choferId !== choferId || oferta.estado !== 'PENDIENTE') return null;
    if (Date.now() >= Date.parse(oferta.venceEn)) {
      this.resolver.get(id)?.('VENCIDA');
      return null;
    }
    this.resolver.get(id)?.(decision === 'ACEPTAR' ? 'ACEPTADA' : 'RECHAZADA');
    return { ...oferta };
  }

  public cancelarRonda(rondaId: string): void {
    for (const oferta of this.registros.values()) {
      if (oferta.rondaId === rondaId) this.resolver.get(oferta.id)?.('CANCELADA');
    }
  }
}
