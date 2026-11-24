import {
    describe,
    expect,
    it,
    vi
} from "vitest";

import redis from "../../src/config/redis";
import {
    credencialFueRevocada,
    revocarCredenciales
} from "../../src/services/credential-revocation.service";
import { marcaDeTiempoMs } from "../../src/utils/reloj";

// "iat" estándar (segundos) que tendría un token emitido en ese milisegundo.
function iatDe(ms: number): number {
    return Math.floor(ms / 1000);
}

describe("RF-1.4 - Servicio de revocación de credenciales", () => {
    it("Considerar revocado un token emitido antes de la revocación", async () => {
        await redis.flushall();

        const emitidoMs = marcaDeTiempoMs() - 60_000;
        await revocarCredenciales(10, "SOLICITUD_DEL_USUARIO");

        const revocada = await credencialFueRevocada(10, { iat: iatDe(emitidoMs), iatMs: emitidoMs });

        expect(revocada).toBe(true);
    });

    it("Aceptar un token emitido después de la revocación", async () => {
        await redis.flushall();

        await revocarCredenciales(10, "CAMBIO_DE_CONTRASENA");
        const emitidoMs = marcaDeTiempoMs();

        const revocada = await credencialFueRevocada(10, { iat: iatDe(emitidoMs), iatMs: emitidoMs });

        expect(revocada).toBe(false);
    });

    it("Aceptar el token de un usuario que nunca revocó", async () => {
        await redis.flushall();

        const revocada = await credencialFueRevocada(11, { iat: 1_700_000_000, iatMs: 1_700_000_000_000 });

        expect(revocada).toBe(false);
    });

    it("Publicar auth.credenciales_revocadas con el usuario y el motivo", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const revocadasDesdeMs = await revocarCredenciales(12, "SOLICITUD_DEL_USUARIO");

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const mensaje = (globalThis as any).__mensajesRabbit[0];

        expect(mensaje.routingKey).toBe("auth.credenciales_revocadas");
        expect(mensaje.contenido.datos).toEqual({
            userId: 12,
            motivo: "SOLICITUD_DEL_USUARIO",
            revocadasDesde: Math.floor(revocadasDesdeMs / 1000),
            revocadasDesdeMs
        });
    });
});

// Caso reportado por M8: "iat" está en segundos, así que un token emitido justo antes
// de revocar y otro emitido justo después pueden tener el mismo "iat".
describe("RF-1.4 - Revocación y tokens emitidos en el mismo segundo", () => {
    it("Rechazar el token anterior y aceptar el nuevo aunque los tres pasos ocurran en el mismo milisegundo", async () => {
        await redis.flushall();

        // Reloj congelado: emitir, revocar y volver a emitir pasan en el mismo instante.
        vi.useFakeTimers({ toFake: ["Date"], now: 1_800_000_000_500 });
        try {
            const anteriorMs = marcaDeTiempoMs();
            await revocarCredenciales(20, "SOLICITUD_DEL_USUARIO");
            const nuevoMs = marcaDeTiempoMs();

            // Los dos tokens tienen el mismo "iat": con segundos no se los puede distinguir.
            expect(iatDe(anteriorMs)).toBe(iatDe(nuevoMs));

            expect(await credencialFueRevocada(20, { iat: iatDe(anteriorMs), iatMs: anteriorMs })).toBe(true);
            expect(await credencialFueRevocada(20, { iat: iatDe(nuevoMs), iatMs: nuevoMs })).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("Rechazar un token sin iatMs (versión anterior de M1) emitido en el mismo segundo de la revocación", async () => {
        await redis.flushall();

        vi.useFakeTimers({ toFake: ["Date"], now: 1_800_000_000_900 });
        try {
            await revocarCredenciales(21, "SOLICITUD_DEL_USUARIO");

            expect(await credencialFueRevocada(21, { iat: 1_800_000_000 })).toBe(true);
            expect(await credencialFueRevocada(21, { iat: 1_799_999_999 })).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it("Entender una marca guardada en segundos por la versión anterior", async () => {
        await redis.flushall();

        // Así guardaba la marca M1 antes de este cambio.
        await redis.set("revocacion:usuario:22", "1800000000", "EX", 3600);

        expect(await credencialFueRevocada(22, { iat: 1_799_999_990, iatMs: 1_799_999_990_000 })).toBe(true);
        expect(await credencialFueRevocada(22, { iat: 1_800_000_000, iatMs: 1_800_000_000_100 })).toBe(false);
    });
});
