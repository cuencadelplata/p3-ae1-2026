import {
    describe,
    expect,
    it
} from "vitest";

import { obtenerCanal } from "../../src/config/rabbitmq";
import {
    EVENTOS_RECUPERACION,
    publicarCredencialesRevocadas,
    publicarRecuperacionSolicitada
} from "../../src/messaging/recovery.publisher";

describe("RF-1.4 - Eventos de recuperación en RabbitMQ", () => {
    it("Publicar auth.recuperacion_solicitada con los datos para enviar el correo", async () => {
        (globalThis as any).__mensajesRabbit.length = 0;

        await publicarRecuperacionSolicitada(
            15,
            "ana@test.com",
            "Ana",
            "a".repeat(64),
            900
        );

        const mensaje = (globalThis as any).__mensajesRabbit[0];

        expect((globalThis as any).__mensajesRabbit.length).toBe(1);
        expect(mensaje.routingKey).toBe(EVENTOS_RECUPERACION.RECUPERACION_SOLICITADA);
        expect(mensaje.contenido.evento).toBe("auth.recuperacion_solicitada");
        expect(mensaje.contenido.modulo).toBe("M1");
        expect(mensaje.contenido.datos).toEqual({
            userId: 15,
            email: "ana@test.com",
            nombre: "Ana",
            token: "a".repeat(64),
            expiraEnSegundos: 900
        });
    });

    it("Incluir un id único y la fecha en cada mensaje", async () => {
        (globalThis as any).__mensajesRabbit.length = 0;

        await publicarCredencialesRevocadas(15, "CAMBIO_DE_CONTRASENA", 1_800_000_000);
        await publicarCredencialesRevocadas(15, "CAMBIO_DE_CONTRASENA", 1_800_000_000);

        const primero = (globalThis as any).__mensajesRabbit[0].contenido;
        const segundo = (globalThis as any).__mensajesRabbit[1].contenido;

        expect(primero.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(primero.id).not.toBe(segundo.id);
        expect(new Date(primero.fecha).toISOString()).toBe(primero.fecha);
    });

    it("Publicar auth.credenciales_revocadas con el motivo", async () => {
        (globalThis as any).__mensajesRabbit.length = 0;

        await publicarCredencialesRevocadas(20, "SOLICITUD_DEL_USUARIO", 1_800_000_000);

        const mensaje = (globalThis as any).__mensajesRabbit[0];

        expect(mensaje.routingKey).toBe(EVENTOS_RECUPERACION.CREDENCIALES_REVOCADAS);
        expect(mensaje.contenido.datos).toEqual({
            userId: 20,
            motivo: "SOLICITUD_DEL_USUARIO",
            revocadasDesde: 1_800_000_000
        });
    });

    it("Rechazar la promesa si RabbitMQ no acepta el mensaje", async () => {
        const canal = await obtenerCanal();
        const publishOriginal = canal.publish;

        canal.publish = () => {
            throw new Error("RabbitMQ caído");
        };

        const resultado = publicarCredencialesRevocadas(20, "SOLICITUD_DEL_USUARIO", 1_800_000_000);

        await expect(resultado).rejects.toThrow("RabbitMQ caído");

        canal.publish = publishOriginal;
    });
});
