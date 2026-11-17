import { z } from 'zod';
import { ServiceUnavailableError, describeError } from '../errors/service-unavailable.error.js';
import { createPolicy, type ResiliencePolicy } from '../resilience/policies.js';
import { UserIdSchema, type CustomerIdentity } from '../types/customer.js';

/**
 * Respuesta de M1 GET /auth/me (rama integration/m1-ae2, user-profile.service.ts):
 * los datos personales del dueño del token. M2 no los guarda ni los cachea.
 */
const textOrNumber = z.union([z.string(), z.number()]).transform(String);
const M1PerfilSchema = z.object({
  userId: UserIdSchema,
  nombre: z.string(),
  apellido: z.string(),
  dni: textOrNumber.nullish(),
  telefono: textOrNumber.nullish(),
  email: z.string(),
  rol: z.string(),
  estado: z.string(),
  creadoEn: z.string().nullish()
});

/**
 * Cliente de M1 para los datos personales del usuario (nombre, email, teléfono, DNI).
 *
 * M1 solo los devuelve al dueño del token: se consultan con el token de quien pide y
 * únicamente cuando ese usuario es el dueño del perfil. Usa la misma política de
 * resiliencia que la validación de tokens ('m1').
 */
export class M1ProfileClient {
  constructor(
    private readonly serviceUrl: () => string = () => process.env.M1_SERVICE_URL ?? 'http://localhost:3000/__stubs/m1',
    private readonly policy: ResiliencePolicy = createPolicy('m1')
  ) {}

  /**
   * @returns los datos del usuario, o null si M1 no los entrega (token rechazado,
   *          usuario bloqueado o inexistente).
   * @throws {ServiceUnavailableError} si M1 no responde o el circuito está abierto.
   */
  async getIdentity(token: string): Promise<(CustomerIdentity & { userId: number }) | null> {
    const url = `${this.serviceUrl().replace(/\/+$/, '')}/auth/me`;

    return this.policy.execute(async (signal) => {
      let response: Response;
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal });
      } catch (err: unknown) {
        if (signal.aborted) throw err;
        throw new ServiceUnavailableError(`M1 no disponible: ${describeError(err)}`);
      }

      if ([401, 403, 404].includes(response.status)) return null;
      if (response.status >= 500) throw new ServiceUnavailableError(`M1 respondió ${response.status}`);
      if (!response.ok) throw new Error(`[M1ProfileClient] M1 respondió ${response.status}`);

      const parsed = M1PerfilSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error(`[M1ProfileClient] Respuesta de M1 fuera de contrato: ${parsed.error.message}`);
      const { userId, nombre, apellido, dni, telefono, email, rol, estado, creadoEn } = parsed.data;
      return { userId, nombre, apellido, dni: dni ?? null, telefono: telefono ?? null, email, rol, estado, creadoEn: creadoEn ?? null };
    }, { idempotent: true });
  }
}

export const m1ProfileClient = new M1ProfileClient();
