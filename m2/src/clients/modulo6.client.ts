import axios, { AxiosInstance } from 'axios';
import CircuitBreaker from 'opossum';

export interface TripData {
  id: string;
  clienteId: string;
  conductorId: string;
  estado: string; // e.g., 'completado', 'en_curso', 'cancelado'
  origen?: string | {direccion:string;latitud:number;longitud:number};
  destino?: string | {direccion:string;latitud:number;longitud:number};
  completadoAt?: string;
  fechaCreacion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class Modulo6UnavailableError extends Error {
  constructor(message = 'El Módulo 6 (Viajes) no está disponible en este momento') {
    super(message);
    this.name = 'Modulo6UnavailableError';
  }
}

export class TripNotFoundError extends Error {
  constructor(tripId: string) {
    super(`El viaje con ID ${tripId} no fue encontrado en el Módulo 6`);
    this.name = 'TripNotFoundError';
  }
}

const M6_BASE_URL = process.env.M6_BASE_URL || 'http://localhost:4000';

const httpClient: AxiosInstance = axios.create({
  baseURL: M6_BASE_URL,
  timeout: 5000, // Timeout explícito de 5 segundos
  headers: {
    'Content-Type': 'application/json',
    'x-service-key': process.env.INTEGRATION_SECRET,
  },
});

async function fetchTripById(tripId: string): Promise<TripData> {
  try {
    let response;
    try {
      // Ruta según especificación OpenAPI M6: GET /api/viajes/{viajeId}
      response = await httpClient.get<{ data?: TripData } & TripData>(`/api/viajes/${tripId}`);
    } catch (err: any) {
      if (err.response && err.response.status === 404) {
        // Fallback de compatibilidad con versión previa (/api/v1/trips/{viajeId})
        response = await httpClient.get<{ data?: TripData } & TripData>(`/api/v1/trips/${tripId}`);
      } else {
        throw err;
      }
    }
    const tripData = response.data.data || response.data;
    return tripData;
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      throw new TripNotFoundError(tripId);
    }
    throw error;
  }
}

// Configuración del Circuit Breaker con Opossum
const circuitBreakerOptions: CircuitBreaker.Options = {
  timeout: 4000, // Tiempo límite para que la llamada responda (4s)
  errorThresholdPercentage: 50, // Porcentaje de fallos para abrir el circuito
  resetTimeout: 10000, // Tiempo (10s) para intentar reconectar (estado Half-Open)
  errorFilter: (err: any) => {
    // Los errores de negocio (404 Not Found o errores de validación de negocio)
    // NO deben hacer trippear el Circuit Breaker.
    if (err instanceof TripNotFoundError || (err.response && err.response.status < 500)) {
      return true;
    }
    return false;
  },
};

/**
 * GET /api/viajes/{id} de M6 no incluye origen ni destino; GET /api/clientes/{clienteId}/viajes sí.
 * Se usa para registrar las direcciones de un viaje completado.
 */
async function fetchClientTrip(clienteId: string, tripId: string): Promise<TripData> {
  try {
    const response = await httpClient.get<{ viajes?: TripData[] }>(`/api/clientes/${encodeURIComponent(clienteId)}/viajes`);
    const trip = response.data?.viajes?.find(v => v?.id === tripId);
    if (!trip) throw new TripNotFoundError(tripId);
    return trip;
  } catch (error: any) {
    if (error instanceof TripNotFoundError) throw error;
    if (error.response && error.response.status === 404) throw new TripNotFoundError(tripId);
    throw error;
  }
}

const breaker = new CircuitBreaker(fetchTripById, circuitBreakerOptions);
const clientTripsBreaker = new CircuitBreaker(fetchClientTrip, circuitBreakerOptions);

async function fireGuarded<T>(cb: CircuitBreaker<any[], T>, ...args: any[]): Promise<T> {
  if (cb.opened) {
    throw new Modulo6UnavailableError('El circuito para Módulo 6 está abierto debido a fallas continuas.');
  }
  try {
    return await cb.fire(...args);
  } catch (error: any) {
    if (error instanceof TripNotFoundError) throw error;
    throw new Modulo6UnavailableError();
  }
}

// Listeners para monitoreo de eventos del Circuit Breaker
breaker.on('open', () => {
  console.warn('[CircuitBreaker] CIRCUITO ABIERTO para llamadas a Módulo 6 (Viajes)');
});

breaker.on('halfOpen', () => {
  console.log('[CircuitBreaker] CIRCUITO HALF-OPEN: Probando conexión con Módulo 6');
});

breaker.on('close', () => {
  console.log('[CircuitBreaker] CIRCUITO CERRADO: Operación normal restaurada con Módulo 6');
});

breaker.on('fallback', (result) => {
  console.warn('[CircuitBreaker] Fallback ejecutado por fallo en Módulo 6');
});

export const modulo6Client = {
  /**
   * Obtiene la información del viaje envolviéndola en el Circuit Breaker.
   */
  async obtenerViajePorId(tripId: string): Promise<TripData> {
    if (breaker.opened) {
      throw new Modulo6UnavailableError('El circuito para Módulo 6 está abierto debido a fallas continuas.');
    }

    try {
      return await breaker.fire(tripId);
    } catch (error: any) {
      if (error.code === 'EOPENBREAKER' || breaker.opened) {
        throw new Modulo6UnavailableError();
      }
      if (error instanceof TripNotFoundError) throw error;
      throw new Modulo6UnavailableError();
    }
  },

  /**
   * Busca el viaje en el historial del cliente en M6, que sí trae origen y destino.
   */
  async obtenerViajeDeCliente(clienteId: string, tripId: string): Promise<TripData> {
    return fireGuarded(clientTripsBreaker, clienteId, tripId);
  },

  /**
   * Retorna el estado actual del Circuit Breaker (para health check o métricas).
   */
  getBreakerStats() {
    return {
      state: breaker.opened ? 'OPEN' : breaker.halfOpen ? 'HALF-OPEN' : 'CLOSED',
      stats: breaker.stats,
    };
  },
};
