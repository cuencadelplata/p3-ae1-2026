import {
    describe,
    expect,
    it
} from "vitest";

import redis from "../../src/config/redis";
import {
    VIDA_JWT_SEGUNDOS,
    guardarMomentoDeRevocacion,
    obtenerMomentoDeRevocacion
} from "../../src/repositories/credential-revocation.repository";

describe("RF-1.4 - Marca de revocación en Redis", () => {
    it("Devolver null si el usuario nunca revocó sus credenciales", async () => {
        await redis.flushall();

        const momento = await obtenerMomentoDeRevocacion(1);

        expect(momento).toBeNull();
    });

    it("Guardar y devolver el momento de la revocación", async () => {
        await redis.flushall();

        await guardarMomentoDeRevocacion(4, 1_800_000_000);

        const momento = await obtenerMomentoDeRevocacion(4);

        expect(momento).toBe(1_800_000_000);
    });

    it("Guardar la marca con el mismo vencimiento que el JWT", async () => {
        await redis.flushall();

        await guardarMomentoDeRevocacion(4, 1_800_000_000);

        const ttl = await redis.ttl("revocacion:usuario:4");

        expect(VIDA_JWT_SEGUNDOS).toBe(3600);
        expect(ttl).toBeGreaterThan(3590);
        expect(ttl).toBeLessThanOrEqual(3600);
    });

    it("No mezclar las marcas de usuarios distintos", async () => {
        await redis.flushall();

        await guardarMomentoDeRevocacion(1, 100);

        const momento = await obtenerMomentoDeRevocacion(2);

        expect(momento).toBeNull();
    });
});
