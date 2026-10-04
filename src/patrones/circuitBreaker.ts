export enum EstadoCircuito {
  CLOSED = "CLOSED",       // Operación normal
  OPEN = "OPEN",           // Disparado: el servicio cayó, no se envían peticiones
  HALF_OPEN = "HALF_OPEN", // En prueba: se verifica si el servicio ya se levantó
}

export interface CircuitBreakerOpciones {
  nombre: string;
  umbralFallos?: number;      // Cantidad de fallos consecutivos antes de abrir
  tiempoEsperaMs?: number;    // Tiempo en OPEN antes de pasar a HALF_OPEN (cooldown)
  timeoutMs?: number;         // Tiempo máximo permitido por petición
}

export class CircuitBreaker {
  public readonly nombre: string;
  private estado: EstadoCircuito = EstadoCircuito.CLOSED;
  private fallosConsecutivos: number = 0;
  private readonly umbralFallos: number;
  private readonly tiempoEsperaMs: number;
  private readonly timeoutMs: number;
  private proximoIntento: number = 0;

  constructor(opciones: CircuitBreakerOpciones) {
    this.nombre = opciones.nombre;
    this.umbralFallos = opciones.umbralFallos ?? 3;
    this.tiempoEsperaMs = opciones.tiempoEsperaMs ?? 15000; // 15 segundos
    this.timeoutMs = opciones.timeoutMs ?? 2000;
  }

  public getEstado(): EstadoCircuito {
    if (this.estado === EstadoCircuito.OPEN && Date.now() >= this.proximoIntento) {
      this.estado = EstadoCircuito.HALF_OPEN;
      console.log(`[CircuitBreaker:${this.nombre}] Transición a HALF-OPEN: Probando si el servicio se recuperó...`);
    }
    return this.estado;
  }

  public async ejecutar<T>(
    operacion: () => Promise<T>,
    fallback?: () => Promise<T> | T
  ): Promise<T> {
    const estadoActual = this.getEstado();

    if (estadoActual === EstadoCircuito.OPEN) {
      if (fallback) {
        return await fallback();
      }
      throw new Error(`[CircuitBreaker:${this.nombre}] Circuito ABIERTO (OPEN). El servicio está caído temporalmente.`);
    }

    try {
      // Ejecución con límite de tiempo (timeout)
      const resultado = await Promise.race([
        operacion(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`[CircuitBreaker:${this.nombre}] Timeout de ${this.timeoutMs}ms excedido`)), this.timeoutMs)
        ),
      ]);

      this.registrarExito();
      return resultado;
    } catch (error) {
      this.registrarFallo(error);
      if (fallback) {
        return await fallback();
      }
      throw error;
    }
  }

  private registrarExito(): void {
    if (this.estado === EstadoCircuito.HALF_OPEN) {
      console.log(`[CircuitBreaker:${this.nombre}] Prueba exitosa en HALF-OPEN. ¡Servicio recuperado! Circuito pasa a CLOSED.`);
    }
    this.fallosConsecutivos = 0;
    this.estado = EstadoCircuito.CLOSED;
  }

  private registrarFallo(error: any): void {
    this.fallosConsecutivos++;
    console.warn(`[CircuitBreaker:${this.nombre}] Fallo detectado (${this.fallosConsecutivos}/${this.umbralFallos}): ${(error as Error)?.message ?? error}`);

    if (this.estado === EstadoCircuito.HALF_OPEN || this.fallosConsecutivos >= this.umbralFallos) {
      this.estado = EstadoCircuito.OPEN;
      this.proximoIntento = Date.now() + this.tiempoEsperaMs;
      console.error(
        `[CircuitBreaker:${this.nombre}] Circuito ABIERTO (OPEN). No se intentarán peticiones durante ${this.tiempoEsperaMs / 1000}s para evitar sobrecargas y degradar con gracia.`
      );
    }
  }
}
