import { defineScript, type CommandParser } from "redis";

import type { ConsumeOutcome } from "./qr.store";

// Scripts Lua del almacenamiento de QR en Redis. Redis ejecuta cada script de forma atómica:
// ningún otro comando, de ninguna instancia del servicio, se intercala mientras corre.
// Se registran en el cliente con `scripts`: node-redis los invoca con EVALSHA y, si Redis
// no los tiene cargados (NOSCRIPT, por ejemplo tras un reinicio o SCRIPT FLUSH), reintenta
// con EVAL.
//
// Ambos scripts toman la hora de Redis (TIME), no la del proceso Node.

// Hora actual de Redis en milisegundos desde epoch.
const REDIS_NOW_MS = `
local time = redis.call('TIME')
local nowMs = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;

// KEYS[1]: clave del QR. ARGV: id, tripId, createdAt, expiresAt, usedAt ('' si no se usó),
// margen posterior al vencimiento; fechas y margen en milisegundos.
// Reemplaza cualquier registro previo de la clave y fija el TTL en el mismo script, así nunca
// queda una clave sin vencimiento. El TTL cubre lo que falta para el vencimiento más el margen,
// y es positivo aunque el registro ya esté vencido.
const SAVE_SCRIPT = `${REDIS_NOW_MS}
local ttlMs = math.max(tonumber(ARGV[4]) - nowMs, 0) + tonumber(ARGV[6])
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'id', ARGV[1], 'tripId', ARGV[2], 'createdAt', ARGV[3], 'expiresAt', ARGV[4])
if ARGV[5] ~= '' then
  redis.call('HSET', KEYS[1], 'usedAt', ARGV[5])
end
redis.call('PEXPIRE', KEYS[1], math.max(ttlMs, 1))
return 'OK'
`;

// KEYS[1]: clave del QR. ARGV[1]: tripId informado en la validación.
// Mismo orden de decisión que el store en memoria. Sólo el caso OK modifica la clave, y HSET
// conserva el TTL existente.
const CONSUME_SCRIPT = `
local record = redis.call('HMGET', KEYS[1], 'tripId', 'expiresAt', 'usedAt')
if not record[1] then
  return 'NOT_FOUND'
end
if record[1] ~= ARGV[1] then
  return 'TRIP_MISMATCH'
end
if record[3] then
  return 'ALREADY_USED'
end
${REDIS_NOW_MS}
if nowMs >= tonumber(record[2]) then
  return 'EXPIRED'
end
redis.call('HSET', KEYS[1], 'usedAt', string.format('%d', nowMs))
return 'OK'
`;

const CONSUME_OUTCOMES: ReadonlySet<string> = new Set<ConsumeOutcome>([
  "OK",
  "NOT_FOUND",
  "TRIP_MISMATCH",
  "ALREADY_USED",
  "EXPIRED",
]);

export interface SaveScriptArgs {
  readonly key: string;
  readonly id: string;
  readonly tripId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly usedAtMs: number | null;
  readonly graceMs: number;
}

export const qrRedisScripts = {
  qrSave: defineScript({
    SCRIPT: SAVE_SCRIPT,
    NUMBER_OF_KEYS: 1,
    parseCommand(parser: CommandParser, args: SaveScriptArgs) {
      parser.pushKey(args.key);
      parser.push(
        args.id,
        args.tripId,
        String(args.createdAtMs),
        String(args.expiresAtMs),
        args.usedAtMs === null ? "" : String(args.usedAtMs),
        String(args.graceMs),
      );
    },
    transformReply: (reply: unknown): void => {
      if (String(reply) !== "OK") {
        throw new Error("Respuesta inesperada del script de guardado de QR.");
      }
    },
  }),
  qrConsume: defineScript({
    SCRIPT: CONSUME_SCRIPT,
    NUMBER_OF_KEYS: 1,
    parseCommand(parser: CommandParser, key: string, tripId: string) {
      parser.pushKey(key);
      parser.push(tripId);
    },
    transformReply: (reply: unknown): ConsumeOutcome => {
      const outcome = String(reply);
      if (!CONSUME_OUTCOMES.has(outcome)) {
        throw new Error("Respuesta inesperada del script de consumo de QR.");
      }
      return outcome as ConsumeOutcome;
    },
  }),
};
