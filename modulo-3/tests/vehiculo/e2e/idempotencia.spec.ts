import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import net from "node:net";
// Mismos helpers que ya usás en vehiculos.spec.ts

function sendRedisCommand(...args: string[]): Promise<string> {
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const payload =
    `*${args.length}\r\n` +
    args
      .map((arg) => {
        const str = String(arg);
        return `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
      })
      .join("");

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(payload);
    });
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      socket.end();
    });
    socket.on("end", () => resolve(response));
    socket.on("error", (err) => reject(err));
    socket.setTimeout(3000, () => {
      socket.destroy(new Error("Redis command timeout"));
    });
  });
}

function driverIdUnico() {
  return String(Date.now() % 1_000_000_000);
}
// Genera una patente válida y distinta en cada llamada (formato AAA000),
// para no toparse con el unique de la base entre tests.
function patenteUnica() {
  const L = () => String.fromCharCode(65 + randomInt(26));
  const n = randomInt(1000).toString().padStart(3, "0");
  return `${L()}${L()}${L()}${n}`;
}

// Genera una key de idempotencia distinta en cada llamada al helper,
// pero la reusamos DENTRO de un mismo test para simular un reintento.
function idempotencyKeyUnica() {
  return `idem-test-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

test.describe("Idempotencia en POST /vehicles (Redis)", () => {
  test("dos POST con la misma Idempotency-Key devuelven el mismo vehículo, sin duplicar", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const patente = patenteUnica();
    const idempotencyKey = idempotencyKeyUnica();
    const body = { patente, tipoServicio: "AUTO", anio: 2020 };

    // Primer pedido: se crea normalmente
    const primera = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: body,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    expect(primera.status()).toBe(201);
    const primerBody = await primera.json();

    // Segundo pedido: mismo body, misma key → reintento
    const segunda = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: body,
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    expect(segunda.status()).toBe(201);
    const segundoBody = await segunda.json();

    // Tiene que ser EXACTAMENTE el mismo vehículo (mismo id y mismo createdAt),
    // no uno nuevo con datos iguales.
    expect(segundoBody.id).toBe(primerBody.id);
    expect(segundoBody.createdAt).toBe(primerBody.createdAt);

    // Confirmamos que en la base quedó un solo vehículo para ese conductor
    const listado = await request.get(
      `/api/v1/drivers/${driverId}/vehicles`,
    );
    const vehiculos = await listado.json();
    expect(vehiculos.length).toBe(1);
  });

  test("dos POST sin Idempotency-Key crean vehículos distintos", async ({
    request,
  }) => {
    const driverId = driverIdUnico();

    const primera = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      { data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 } },
    );
    expect(primera.status()).toBe(201);
    const primerBody = await primera.json();

    const segunda = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      { data: { patente: patenteUnica(), tipoServicio: "MOTO", anio: 2021 } },
    );
    expect(segunda.status()).toBe(201);
    const segundoBody = await segunda.json();

    // Sin key, cada POST es independiente: ids distintos
    expect(segundoBody.id).not.toBe(primerBody.id);

    const listado = await request.get(
      `/api/v1/drivers/${driverId}/vehicles`,
    );
    const vehiculos = await listado.json();
    expect(vehiculos.length).toBe(2);
  });

  test("dos POST con distinta Idempotency-Key crean vehículos distintos", async ({
    request,
  }) => {
    const driverId = driverIdUnico();

    const primera = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: { patente: patenteUnica(), tipoServicio: "AUTO", anio: 2020 },
        headers: { "Idempotency-Key": idempotencyKeyUnica() },
      },
    );
    expect(primera.status()).toBe(201);
    const primerBody = await primera.json();

    const segunda = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: { patente: patenteUnica(), tipoServicio: "MOTO", anio: 2022 },
        headers: { "Idempotency-Key": idempotencyKeyUnica() },
      },
    );
    expect(segunda.status()).toBe(201);
    const segundoBody = await segunda.json();

    expect(segundoBody.id).not.toBe(primerBody.id);

    const listado = await request.get(
      `/api/v1/drivers/${driverId}/vehicles`,
    );
    const vehiculos = await listado.json();
    expect(vehiculos.length).toBe(2);
  });

  test("no cachea respuestas de error 4xx en Redis cuando se envía Idempotency-Key", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const idempotencyKey = idempotencyKeyUnica();

    // Primer intento inválido (patente mal formada -> 400)
    const fallida = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: { patente: "MALFORMADA", tipoServicio: "AUTO", anio: 2020 },
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    expect(fallida.status()).toBe(400);

    // Reintento con la misma Idempotency-Key y datos válidos debe procesarse (201)
    const patenteValida = patenteUnica();
    const exitosa = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: { patente: patenteValida, tipoServicio: "AUTO", anio: 2020 },
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
    expect(exitosa.status()).toBe(201);
    const body = await exitosa.json();
    expect(body.patente).toBe(patenteValida);
  });

  test("tolera fallos de Redis sin bloquear POST /vehicles y retoma idempotencia al recuperarse", async ({
    request,
  }) => {
    const driverId = driverIdUnico();
    const keyDuranteCaida = idempotencyKeyUnica();
    const patenteDuranteCaida = patenteUnica();

    try {
      // Simular fallo de Redis para que redis.get / redis.set rechacen sin colgar el servicio
      await sendRedisCommand("CLIENT", "PAUSE", "8000");

      const resConKey = await request.post(
        `/api/v1/drivers/${driverId}/vehicles`,
        {
          data: {
            patente: patenteDuranteCaida,
            tipoServicio: "AUTO",
            anio: 2021,
          },
          headers: { "Idempotency-Key": keyDuranteCaida },
        },
      );
      expect(resConKey.status()).toBe(201);
      const bodyConKey = await resConKey.json();
      expect(bodyConKey.id).toBeTruthy();
      expect(bodyConKey.patente).toBe(patenteDuranteCaida);

      const resSinKey = await request.post(
        `/api/v1/drivers/${driverId}/vehicles`,
        {
          data: {
            patente: patenteUnica(),
            tipoServicio: "MOTO",
            anio: 2022,
          },
        },
      );
      expect(resSinKey.status()).toBe(201);

      const listado = await request.get(
        `/api/v1/drivers/${driverId}/vehicles`,
      );
      expect(listado.status()).toBe(200);
      const vehiculos = await listado.json();
      expect(vehiculos.length).toBe(2);
    } finally {
      await sendRedisCommand("CLIENT", "UNPAUSE");
    }

    // Verificar que al volver Redis la idempotencia funciona normalmente
    const keyRecuperado = idempotencyKeyUnica();
    const patenteRecuperado = patenteUnica();
    const payloadRecuperado = {
      patente: patenteRecuperado,
      tipoServicio: "AUTO",
      anio: 2023,
    };

    const post1 = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: payloadRecuperado,
        headers: { "Idempotency-Key": keyRecuperado },
      },
    );
    expect(post1.status()).toBe(201);
    const body1 = await post1.json();

    const post2 = await request.post(
      `/api/v1/drivers/${driverId}/vehicles`,
      {
        data: payloadRecuperado,
        headers: { "Idempotency-Key": keyRecuperado },
      },
    );
    expect(post2.status()).toBe(201);
    const body2 = await post2.json();

    expect(body2.id).toBe(body1.id);
    expect(body2.createdAt).toBe(body1.createdAt);
  });
});