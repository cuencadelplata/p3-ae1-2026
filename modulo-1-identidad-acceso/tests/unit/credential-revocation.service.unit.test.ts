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

describe("RF-1.4 - Servicio de revocación de credenciales", () => {
    it("Considerar revocado un token emitido antes de la revocación", async () => {
        await redis.flushall();

        const revocadasDesde = await revocarCredenciales(10, "SOLICITUD_DEL_USUARIO");

        const revocada = await credencialFueRevocada(10, revocadasDesde - 60);

        expect(revocada).toBe(true);
    });

    it("Aceptar un token emitido después de la revocación", async () => {
        await redis.flushall();

        const revocadasDesde = await revocarCredenciales(10, "CAMBIO_DE_CONTRASENA");

        const revocada = await credencialFueRevocada(10, revocadasDesde + 5);

        expect(revocada).toBe(false);
    });

    it("Aceptar el token de un usuario que nunca revocó", async () => {
        await redis.flushall();

        const revocada = await credencialFueRevocada(11, 1_700_000_000);

        expect(revocada).toBe(false);
    });

    it("Publicar auth.credenciales_revocadas con el usuario y el motivo", async () => {
        await redis.flushall();
        (globalThis as any).__mensajesRabbit.length = 0;

        const revocadasDesde = await revocarCredenciales(12, "SOLICITUD_DEL_USUARIO");

        await vi.waitFor(() => {
            expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        });

        const mensaje = (globalThis as any).__mensajesRabbit[0];

        expect(mensaje.routingKey).toBe("auth.credenciales_revocadas");
        expect(mensaje.contenido.datos).toEqual({
            userId: 12,
            motivo: "SOLICITUD_DEL_USUARIO",
            revocadasDesde
        });
    });
});
