// AE4 - Test end-to-end de RF-1.1 (Registro) y RF-1.3 (Validación de identidad y rol).
// Pega contra M1 real por HTTP, sin mocks.
// Correr con: npm run test:e2e:rf11-rf13  (M1 tiene que estar levantado)

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import {
    api,
    esperarDesbloqueo,
    leerMetrica,
    login
} from "./helpers-ae4.mjs";

// Datos únicos por corrida, para poder repetir el test sin limpiar la base.
function datosUsuario(rol) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    return {
        nombre: "E2E",
        apellido: `rf11-${rol.toLowerCase()}`,
        dni: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
        telefono: "3794 222222",
        email: `rf11-${rol.toLowerCase()}-${id}@e2e.test`,
        password: "secreta123",
        rol
    };
}

function registrar(usuario) {
    return api("/auth/registrar-usuario", { method: "POST", body: usuario });
}

// Así llaman los otros módulos (M2, M3, ...) a M1 para validar el token de un usuario.
function validarIdentidad(token) {
    return api("/auth/validar-identidad-y-rol", { token });
}

const serieValidacion = (resultado) =>
    `m1_validaciones_identidad_total{resultado="${resultado}"}`;

// Usuarios registrados en el primer bloque, reutilizados en los siguientes.
const registrados = {};

describe("AE4 - RF-1.1 Registro de punta a punta", () => {
    before(async () => {
        const health = await api("/health");
        assert.equal(health.status, 200, "M1 no responde en /health: ¿está levantado?");
    });

    for (const rol of ["CLIENTE", "CONDUCTOR"]) {
        test(`Registrar un ${rol} devuelve 201 con su rol y sin la contraseña`, async () => {
            const usuario = datosUsuario(rol);
            const respuesta = await registrar(usuario);

            assert.equal(respuesta.status, 201);
            assert.ok(respuesta.body.id, "falta el id");
            assert.equal(respuesta.body.rol, rol);
            assert.equal(respuesta.body.email, usuario.email);
            assert.equal(respuesta.body.password, undefined);
            assert.equal(respuesta.body.password_hash, undefined);

            registrados[rol] = { ...usuario, id: respuesta.body.id };
        });
    }

    test("OPERADOR no se puede autorregistrar: 400", async () => {
        const respuesta = await registrar(datosUsuario("OPERADOR"));

        assert.equal(respuesta.status, 400);
    });

    test("Email repetido devuelve 409", async () => {
        const original = registrados.CLIENTE;
        const repetido = { ...datosUsuario("CLIENTE"), email: original.email };

        const respuesta = await registrar(repetido);

        assert.equal(respuesta.status, 409);
        assert.match(respuesta.body.error, /email/i);
    });

    test("Email repetido con otras mayúsculas y espacios también devuelve 409", async () => {
        const original = registrados.CLIENTE;
        const repetido = {
            ...datosUsuario("CLIENTE"),
            email: `  ${original.email.toUpperCase()}  `
        };

        const respuesta = await registrar(repetido);

        assert.equal(respuesta.status, 409);
    });

    test("DNI repetido devuelve 409", async () => {
        const original = registrados.CONDUCTOR;
        const repetido = { ...datosUsuario("CONDUCTOR"), dni: original.dni };

        const respuesta = await registrar(repetido);

        assert.equal(respuesta.status, 409);
        assert.match(respuesta.body.error, /DNI/i);
    });

    test("Datos inválidos devuelven 400", async () => {
        const invalido = { ...datosUsuario("CLIENTE"), email: "no-es-un-email", dni: "12" };

        const respuesta = await registrar(invalido);

        assert.equal(respuesta.status, 400);
    });
});

describe("AE4 - RF-1.3 Validación de identidad y rol de punta a punta", () => {
    const tokens = {};

    before(async () => {
        for (const rol of ["CLIENTE", "CONDUCTOR"]) {
            const usuario = registrados[rol];
            assert.ok(usuario, `no se registró el ${rol} en el bloque anterior`);

            await esperarDesbloqueo(usuario.email, usuario.password);

            const respuesta = await login(usuario.email, usuario.password);
            assert.equal(respuesta.status, 200, `no pudo iniciar sesión el ${rol}`);
            tokens[rol] = respuesta.body.token;
        }
    });

    for (const rol of ["CLIENTE", "CONDUCTOR"]) {
        test(`Otro módulo valida el token de un ${rol} y recibe valid: true con su rol`, async () => {
            const antes = await leerMetrica(serieValidacion("valida"));

            const respuesta = await validarIdentidad(tokens[rol]);

            assert.equal(respuesta.status, 200);
            assert.equal(respuesta.body.valid, true);
            assert.equal(respuesta.body.userId, registrados[rol].id);
            assert.equal(respuesta.body.role, rol);
            assert.equal(respuesta.body.usuario.rol, rol);
            assert.equal(respuesta.body.usuario.estado, "ACTIVO");
            assert.equal(respuesta.body.usuario.password_hash, undefined);

            assert.equal(await leerMetrica(serieValidacion("valida")), antes + 1);
        });
    }

    test("Sin token o con un token inválido responde 401 y se cuenta como token_rechazado", async () => {
        const antes = await leerMetrica(serieValidacion("token_rechazado"));

        const sinToken = await api("/auth/validar-identidad-y-rol");
        const tokenInvalido = await validarIdentidad("abc.def.ghi");

        assert.equal(sinToken.status, 401);
        assert.equal(tokenInvalido.status, 401);
        assert.equal(await leerMetrica(serieValidacion("token_rechazado")), antes + 2);
    });

    test("Cada rol entra solo a su ruta (CONDUCTOR al portal, CLIENTE no)", async () => {
        const conductor = await api("/auth/portal-conductor", { token: tokens.CONDUCTOR });
        const cliente = await api("/auth/portal-conductor", { token: tokens.CLIENTE });
        const adminConConductor = await api("/auth/admin-panel", { token: tokens.CONDUCTOR });

        assert.equal(conductor.status, 200);
        assert.equal(cliente.status, 403);
        assert.equal(adminConConductor.status, 403);
    });
});
