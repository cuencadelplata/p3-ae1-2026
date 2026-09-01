import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMAGE_TAG = "m8-notifications-service:local";
const CONTAINER_NAME = `m8-qr-e2e-${randomUUID().slice(0, 8)}`;

// Puerto de host alto y fijo (no aleatorio, a propósito), elegido para minimizar
// colisión con servicios locales típicos (3000, 5432, 8080, etc.): 39481.
const HOST_PORT = 39481;
const CONTAINER_PORT = 3000;
const QR_TTL_SECONDS = 120;
const BASE_URL = `http://localhost:${HOST_PORT}`;

const DOCKER_BUILD_TIMEOUT_MS = 5 * 60_000;
const DOCKER_COMMAND_TIMEOUT_MS = 30_000;
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_INTERVAL_MS = 500;
const BEFORE_ALL_TIMEOUT_MS = 6 * 60_000;
const TEST_TIMEOUT_MS = 30_000;
const AFTER_ALL_TIMEOUT_MS = 30_000;

let containerStarted = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sondeo de readiness sin efectos secundarios: un body inválido ({}) siempre da 400
// VALIDATION_ERROR si Express y las rutas de QR ya están arriba, y nunca crea un QR
// real en el store (a diferencia de un POST /qr válido).
async function waitForReadiness(): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.status === 400) {
        const body = (await response.json()) as { error?: { code?: string } };
        if (body.error?.code === "VALIDATION_ERROR") {
          return;
        }
      }
    } catch {
      // El contenedor todavía no acepta conexiones. Reintentar.
    }

    await sleep(READINESS_INTERVAL_MS);
  }

  throw new Error(
    `El servicio no respondió 400 VALIDATION_ERROR en ${BASE_URL}/qr dentro de ${READINESS_TIMEOUT_MS}ms ` +
      "de espera de readiness. El contenedor no llegó a estar listo (o no arrancó) a tiempo.",
  );
}

describe("E2E — imagen Docker del servicio M8 (RF-8.2)", () => {
  beforeAll(async () => {
    await execFileAsync("docker", ["build", "-t", IMAGE_TAG, "."], {
      cwd: PROJECT_ROOT,
      timeout: DOCKER_BUILD_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 20,
    });

    await execFileAsync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        CONTAINER_NAME,
        "-e",
        `PORT=${CONTAINER_PORT}`,
        "-e",
        `QR_TTL_SECONDS=${QR_TTL_SECONDS}`,
        "-p",
        `${HOST_PORT}:${CONTAINER_PORT}`,
        IMAGE_TAG,
      ],
      { timeout: DOCKER_COMMAND_TIMEOUT_MS },
    );
    containerStarted = true;

    await waitForReadiness();
  }, BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    if (!containerStarted) {
      return;
    }

    try {
      await execFileAsync("docker", ["stop", CONTAINER_NAME], { timeout: DOCKER_COMMAND_TIMEOUT_MS });
    } catch (error) {
      console.error(`No se pudo detener el contenedor ${CONTAINER_NAME}:`, error);
    }

    try {
      await execFileAsync("docker", ["rm", CONTAINER_NAME], { timeout: DOCKER_COMMAND_TIMEOUT_MS });
    } catch (error) {
      console.error(`No se pudo eliminar el contenedor ${CONTAINER_NAME}:`, error);
    }
  }, AFTER_ALL_TIMEOUT_MS);

  it(
    "genera, valida y revalida un QR contra el contenedor real, leyendo QR_TTL_SECONDS del entorno",
    async () => {
      const generateResponse = await fetch(`${BASE_URL}/qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: "trip-e2e-001" }),
      });
      expect(generateResponse.status).toBe(201);

      const generateBody = (await generateResponse.json()) as {
        token: string;
        qrDataUrl: string;
        expiresAt: string;
      };
      expect(generateBody.qrDataUrl).toMatch(/^data:image\/png;base64,/);

      // Prueba diferencial: el TTL efectivo tiene que reflejar QR_TTL_SECONDS=120 pasado
      // por -e al contenedor, no el default de código (300). Tolerancia amplia por
      // latencia de red/Docker.
      const actualTtlSeconds = (new Date(generateBody.expiresAt).getTime() - Date.now()) / 1000;
      expect(actualTtlSeconds).toBeGreaterThan(QR_TTL_SECONDS - 20);
      expect(actualTtlSeconds).toBeLessThan(QR_TTL_SECONDS + 20);

      const validateResponse = await fetch(`${BASE_URL}/qr/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: "trip-e2e-001", token: generateBody.token }),
      });
      expect(validateResponse.status).toBe(200);
      expect(await validateResponse.json()).toEqual({ valid: true });

      const revalidateResponse = await fetch(`${BASE_URL}/qr/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId: "trip-e2e-001", token: generateBody.token }),
      });
      expect(revalidateResponse.status).toBe(409);
      expect(await revalidateResponse.json()).toEqual({
        error: { code: "QR_ALREADY_USED", message: "El QR ya fue utilizado." },
      });
    },
    TEST_TIMEOUT_MS,
  );
});
