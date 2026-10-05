import { defineScript, type CommandParser } from "redis";

import type { ConsumeOutcome, QrGetOrCreateResult } from "./qr.store";

// Scripts Lua del almacenamiento de QR en Redis. Redis ejecuta cada script de forma atómica:
// ningún otro comando, de ninguna instancia del servicio, se intercala mientras corre.
// Se registran en el cliente con `scripts`: node-redis los invoca con EVALSHA y, si Redis
// no los tiene cargados (NOSCRIPT, por ejemplo tras un reinicio o SCRIPT FLUSH), reintenta
// con EVAL.
//
// Los scripts toman la hora de Redis (TIME), no la del proceso Node.

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

// KEYS[1]: clave del QR candidato. KEYS[2]: índice del QR operativo del viaje.
// ARGV: id, tripId, tokenHash, token, createdAt, expiresAt, margen posterior al vencimiento,
// prefijo de claves QR.
//
// Si el índice apunta a un QR activo (mismo viaje, no usado y no vencido), devuelve ese QR
// existente sin renovar su TTL. Si no hay QR operativo, guarda el candidato y lo marca como
// QR operativo del viaje. Todo ocurre en un único script atómico.
const GET_OR_CREATE_SCRIPT = `${REDIS_NOW_MS}
local existingHash = redis.call('GET', KEYS[2])
if existingHash then
  local existingKey = ARGV[8] .. existingHash
  local existing = redis.call('HMGET', existingKey, 'id', 'tripId', 'token', 'createdAt', 'expiresAt', 'usedAt')
  if existing[1] and existing[2] == ARGV[2] and not existing[6] and nowMs < tonumber(existing[5]) then
    return {'EXISTING', existing[1], existing[2], existingHash, existing[3], existing[4], existing[5]}
  end
end

local ttlMs = math.max(tonumber(ARGV[6]) - nowMs, 0) + tonumber(ARGV[7])
redis.call('DEL', KEYS[1])
redis.call(
  'HSET',
  KEYS[1],
  'id', ARGV[1],
  'tripId', ARGV[2],
  'token', ARGV[4],
  'createdAt', ARGV[5],
  'expiresAt', ARGV[6]
)
redis.call('PEXPIRE', KEYS[1], math.max(ttlMs, 1))
redis.call('SET', KEYS[2], ARGV[3], 'PX', math.max(ttlMs, 1))
return {'CREATED', ARGV[1], ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6]}
`;

// KEYS[1]: clave del QR. KEYS[2]: índice del QR operativo del viaje.
// ARGV[1]: tripId informado en la validación. ARGV[2]: tokenHash.
// Mismo orden de decisión que el store en memoria. Sólo el caso OK modifica la clave, y HSET
// conserva el TTL existente. Si se consume el QR operativo del viaje, elimina el índice para
// permitir que POST /qr cree uno nuevo.
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
if redis.call('GET', KEYS[2]) == ARGV[2] then
  redis.call('DEL', KEYS[2])
end
return 'OK'
`;

export class QrScriptReplyError extends Error {
  constructor(script: "qrSave" | "qrGetOrCreate" | "qrConsume") {
    super(`Respuesta inesperada del script ${script}.`);
    this.name = "QrScriptReplyError";
  }
}

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

export interface GetOrCreateScriptArgs {
  readonly qrKey: string;
  readonly tripKey: string;
  readonly keyPrefix: string;
  readonly id: string;
  readonly tripId: string;
  readonly tokenHash: string;
  readonly token: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly graceMs: number;
}

function parseGetOrCreateReply(reply: unknown): QrGetOrCreateResult {
  if (!Array.isArray(reply) || reply.length !== 7) {
    throw new QrScriptReplyError("qrGetOrCreate");
  }

  const [outcome, id, tripId, tokenHash, token, createdAtMs, expiresAtMs] = reply.map(String);
  if (outcome !== "CREATED" && outcome !== "EXISTING") {
    throw new QrScriptReplyError("qrGetOrCreate");
  }

  return {
    created: outcome === "CREATED",
    record: {
      id,
      tripId,
      tokenHash,
      token,
      createdAt: new Date(Number(createdAtMs)),
      expiresAt: new Date(Number(expiresAtMs)),
      usedAt: null,
    },
  };
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
        throw new QrScriptReplyError("qrSave");
      }
    },
  }),
  qrGetOrCreate: defineScript({
    SCRIPT: GET_OR_CREATE_SCRIPT,
    NUMBER_OF_KEYS: 2,
    parseCommand(parser: CommandParser, args: GetOrCreateScriptArgs) {
      parser.pushKey(args.qrKey);
      parser.pushKey(args.tripKey);
      parser.push(
        args.id,
        args.tripId,
        args.tokenHash,
        args.token,
        String(args.createdAtMs),
        String(args.expiresAtMs),
        String(args.graceMs),
        args.keyPrefix,
      );
    },
    transformReply: parseGetOrCreateReply,
  }),
  qrConsume: defineScript({
    SCRIPT: CONSUME_SCRIPT,
    NUMBER_OF_KEYS: 2,
    parseCommand(parser: CommandParser, key: string, tripKey: string, tripId: string, tokenHash: string) {
      parser.pushKey(key);
      parser.pushKey(tripKey);
      parser.push(tripId, tokenHash);
    },
    transformReply: (reply: unknown): ConsumeOutcome => {
      const outcome = String(reply);
      if (!CONSUME_OUTCOMES.has(outcome)) {
        throw new QrScriptReplyError("qrConsume");
      }
      return outcome as ConsumeOutcome;
    },
  }),
};
