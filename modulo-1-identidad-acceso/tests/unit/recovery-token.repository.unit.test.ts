import {
    describe,
    expect,
    it,
    vi
} from "vitest";

import redis from "../../src/config/redis";
import {
    TTL_TOKEN_SEGUNDOS,
    consumirTokenDeRecuperacion,
    guardarTokenDeRecuperacion,
    segundosRestantesDelToken
} from "../../src/repositories/recovery-token.repository";

describe("RF-1.4 - Token de recuperación en Redis", () => {
    it("Guardar el token con un vencimiento de 15 minutos", async () => {
        await redis.flushall();

        await guardarTokenDeRecuperacion(1, "a".repeat(64));

        const ttl = await segundosRestantesDelToken("a".repeat(64));

        expect(TTL_TOKEN_SEGUNDOS).toBe(900);
        expect(ttl).toBeGreaterThan(890);
        expect(ttl).toBeLessThanOrEqual(900);
    });

    it("No guardar el token en texto plano", async () => {
        await redis.flushall();

        await guardarTokenDeRecuperacion(1, "b".repeat(64));

        const claves = await redis.keys("*");

        expect(claves.length).toBe(2);
        expect(claves.join(" ")).not.toContain("b".repeat(64));
    });

    it("Devolver el usuario dueño del token y borrarlo al consumirlo", async () => {
        await redis.flushall();

        await guardarTokenDeRecuperacion(7, "c".repeat(64));

        const primerUso = await consumirTokenDeRecuperacion("c".repeat(64));
        const segundoUso = await consumirTokenDeRecuperacion("c".repeat(64));

        expect(primerUso).toBe(7);
        expect(segundoUso).toBeNull();
        expect(await redis.keys("*")).toEqual([]);
    });

    it("Devolver null si el token no existe", async () => {
        await redis.flushall();

        const resultado = await consumirTokenDeRecuperacion("d".repeat(64));

        expect(resultado).toBeNull();
    });

    it("Invalidar el token anterior cuando el mismo usuario pide otro", async () => {
        await redis.flushall();

        await guardarTokenDeRecuperacion(3, "e".repeat(64));
        await guardarTokenDeRecuperacion(3, "f".repeat(64));

        const viejo = await consumirTokenDeRecuperacion("e".repeat(64));
        const nuevo = await consumirTokenDeRecuperacion("f".repeat(64));

        expect(viejo).toBeNull();
        expect(nuevo).toBe(3);
    });

    it("Entregar el token a un solo pedido cuando llegan dos al mismo tiempo", async () => {
        await redis.flushall();

        await guardarTokenDeRecuperacion(9, "1".repeat(64));

        const resultados = await Promise.all([
            consumirTokenDeRecuperacion("1".repeat(64)),
            consumirTokenDeRecuperacion("1".repeat(64))
        ]);

        expect(resultados.filter((r) => r === 9).length).toBe(1);
        expect(resultados.filter((r) => r === null).length).toBe(1);
    });

    it("Dejar de existir cuando pasan los 15 minutos", async () => {
        await redis.flushall();

        await guardarTokenDeRecuperacion(5, "2".repeat(64));

        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 901 * 1000);

        const resultado = await consumirTokenDeRecuperacion("2".repeat(64));

        vi.useRealTimers();

        expect(resultado).toBeNull();
    });
});
