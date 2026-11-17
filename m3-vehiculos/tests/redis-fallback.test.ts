import { describe, jest, beforeEach, afterEach, it, expect } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

const mockConnect = jest.fn<() => Promise<void>>();
const mockGet = jest.fn<(key: string) => Promise<string | null>>();
const mockSet = jest.fn<(key: string, value: string, options?: { EX?: number }) => Promise<string | null>>();
const mockOn = jest.fn();

const mockRedisInstance = {
  isOpen: false,
  connect: mockConnect,
  get: mockGet,
  set: mockSet,
  on: mockOn,
};

const mockCreateClient = jest.fn(() => mockRedisInstance);

jest.unstable_mockModule("redis", () => ({
  createClient: mockCreateClient,
}));

const { redis, connectRedis } = await import("../src/config/redisClient.js");
const { idempotencia } = await import("../src/middlewares/idempotencia.js");

describe("Redis Fallback & Resiliencia (m3-vehiculos)", () => {
  const originalEnv = process.env.REDIS_URL;

  beforeEach(() => {
    mockConnect.mockClear();
    mockGet.mockClear();
    mockSet.mockClear();
    mockRedisInstance.isOpen = false;
    process.env.REDIS_URL = "redis://localhost:6379";
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalEnv;
    }
    jest.restoreAllMocks();
  });

  describe("1. Configuración y conexión resiliente (redisClient.ts)", () => {
    it("debe invocar createClient con disableOfflineQueue: true, connectTimeout: 1000 y reconnectStrategy exponencial acotada a 5000ms", () => {
      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      const clientOptions = (mockCreateClient.mock.calls[0] as unknown as [any])[0];

      expect(clientOptions).toBeDefined();
      expect(clientOptions.disableOfflineQueue).toBe(true);
      expect(clientOptions.socket).toBeDefined();
      expect(clientOptions.socket.connectTimeout).toBe(1000);
      expect(typeof clientOptions.socket.reconnectStrategy).toBe("function");

      const { reconnectStrategy } = clientOptions.socket;
      expect(reconnectStrategy(1)).toBe(200);
      expect(reconnectStrategy(5)).toBe(1000);
      expect(reconnectStrategy(25)).toBe(5000);
      expect(reconnectStrategy(50)).toBe(5000);
    });

    it("debe registrar un listener para el evento 'error' en el cliente Redis", () => {
      expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));
      const errorCall = mockOn.mock.calls.find((call) => call[0] === "error");
      const errorHandler = errorCall?.[1] as (err: Error) => void;

      expect(() => errorHandler(new Error("ECONNREFUSED"))).not.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        "[redis] Error de conexión:",
        expect.any(Error),
      );
    });

    it("connectRedis() debe llamar a redis.connect() cuando REDIS_URL está configurado y isOpen es false", async () => {
      mockRedisInstance.isOpen = false;
      mockConnect.mockResolvedValueOnce(undefined);

      await connectRedis();

      expect(redis.connect).toHaveBeenCalledTimes(1);
    });

    it("connectRedis() debe lanzar error y no reconectar si falta REDIS_URL", async () => {
      delete process.env.REDIS_URL;

      await expect(connectRedis()).rejects.toThrow(
        "Falta REDIS_URL en las variables de entorno",
      );
      expect(redis.connect).not.toHaveBeenCalled();
    });

    it("arranque no bloqueante: si connectRedis() rechaza al iniciar, se captura en .catch() sin bloquear la ejecución", async () => {
      mockConnect.mockRejectedValueOnce(new Error("Connection timeout"));

      let startupContinued = false;
      connectRedis()
        .then(() => console.log(" Conectado a Redis"))
        .catch((err) =>
          console.warn("[redis] No disponible al arrancar, se continúa sin Redis:", err),
        );
      startupContinued = true;

      expect(startupContinued).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
      expect(console.warn).toHaveBeenCalledWith(
        "[redis] No disponible al arrancar, se continúa sin Redis:",
        expect.any(Error),
      );
    });
  });

  describe("2. Middleware de idempotencia y tolerancia a fallos (idempotencia.ts)", () => {
    const createMockReqRes = (idempotencyKey?: string, statusCode = 201) => {
      const req = {
        header: jest.fn((name: string) =>
          name.toLowerCase() === "idempotency-key" ? idempotencyKey : undefined,
        ),
      } as unknown as Request;

      const res: any = {
        statusCode,
        status: jest.fn(function (this: any, code: number) {
          this.statusCode = code;
          return this;
        }),
      };
      res.json = jest.fn(function (this: any, body: unknown) {
        this.body = body;
        return this;
      });

      const next = jest.fn() as NextFunction;
      return { req, res: res as Response, next };
    };

    it("sin header Idempotency-Key debe llamar a next() sin consultar Redis", async () => {
      const { req, res, next } = createMockReqRes(undefined);

      await idempotencia(req, res, next);

      expect(mockGet).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("con Idempotency-Key y respuesta en caché de Redis debe devolver el status y body cacheados sin llamar a next()", async () => {
      const cachedPayload = {
        status: 201,
        body: { id: "veh-123", patente: "AB123CD" },
      };
      mockGet.mockResolvedValueOnce(JSON.stringify(cachedPayload));

      const { req, res, next } = createMockReqRes("key-cached-1");

      await idempotencia(req, res, next);

      expect(mockGet).toHaveBeenCalledWith("idempotency:key-cached-1");
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(cachedPayload.body);
      expect(next).not.toHaveBeenCalled();
    });

    it("con Idempotency-Key sin caché en Redis debe ejecutar next() y al responder con 2xx guardar en Redis con EX: 86400", async () => {
      mockGet.mockResolvedValueOnce(null);
      mockSet.mockResolvedValueOnce("OK");

      const { req, res, next } = createMockReqRes("key-new-1", 201);

      await idempotencia(req, res, next);

      expect(mockGet).toHaveBeenCalledWith("idempotency:key-new-1");
      expect(next).toHaveBeenCalledTimes(1);

      const responseBody = { id: "veh-456", patente: "CD456EF" };
      res.json(responseBody);

      expect(mockSet).toHaveBeenCalledWith(
        "idempotency:key-new-1",
        JSON.stringify({ status: 201, body: responseBody }),
        { EX: 86400 },
      );
    });

    it("con Idempotency-Key sin caché en Redis no debe guardar en Redis si la respuesta no es 2xx", async () => {
      mockGet.mockResolvedValueOnce(null);

      const { req, res, next } = createMockReqRes("key-error-400", 400);

      await idempotencia(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      res.json({ error: "Bad Request" });

      expect(mockSet).not.toHaveBeenCalled();
    });

    it("cuando Redis está caído / rechaza inmediatamente por disableOfflineQueue: true en redis.get, captura el error y llama a next() sin bloquear la petición", async () => {
      mockGet.mockRejectedValueOnce(new Error("The client is closed"));

      const { req, res, next } = createMockReqRes("key-redis-down");

      await idempotencia(req, res, next);

      expect(mockGet).toHaveBeenCalledWith("idempotency:key-redis-down");
      expect(console.error).toHaveBeenCalledWith(
        "[idempotencia] Error leyendo Redis:",
        expect.any(Error),
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("cuando redis.set rechaza al guardar la respuesta de idempotencia, captura el error en el .catch() sin romper res.json()", async () => {
      mockGet.mockResolvedValueOnce(null);
      mockSet.mockRejectedValueOnce(new Error("Redis write failed: client is closed"));

      const { req, res, next } = createMockReqRes("key-set-fail", 200);

      await idempotencia(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      const payload = { ok: true };
      expect(() => res.json(payload)).not.toThrow();

      // Esperar microtask del .catch() de la promesa de redis.set
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockSet).toHaveBeenCalledWith(
        "idempotency:key-set-fail",
        JSON.stringify({ status: 200, body: payload }),
        { EX: 86400 },
      );
      expect(console.error).toHaveBeenCalledWith(
        "[idempotencia] Error guardando en Redis:",
        expect.any(Error),
      );
    });
  });
});
