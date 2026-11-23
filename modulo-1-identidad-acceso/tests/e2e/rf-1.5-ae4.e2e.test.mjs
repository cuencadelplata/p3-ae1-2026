// AE4 - Test end-to-end de RF-1.5 (Integración estándar OAuth2 / OpenID Connect).
// Pega contra M1 real por HTTP, sin mocks del lado del test.
// Usa el proveedor MOCK de M1, que simula un IdP sin credenciales ni internet:
// así el flujo completo (authorize -> callback -> JWT de M1) se puede probar en cualquier máquina.
// Correr con: npm run test:e2e:rf15  (M1 tiene que estar levantado)
//
// El proveedor MOCK siempre devuelve la misma identidad externa. La primera corrida crea
// el usuario local y lo vincula; las siguientes reutilizan ese mismo usuario.

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { api, BASE_URL } from "./helpers-ae4.mjs";

const EMAIL_MOCK = "usuario.oauth2@movilidad-urbana.test";

// Paso 1 del flujo: M1 arma la URL del proveedor con state firmado y PKCE.
function autorizar(provider, extra = "") {
    return api(`/auth/oauth2/authorize?provider=${provider}${extra}`);
}

// Paso 2: el proveedor devuelve un code y M1 lo canjea por su propio JWT.
function callback(body) {
    return api("/auth/oauth2/callback", { method: "POST", body });
}

async function loginConMock() {
    const auth = await autorizar("MOCK");
    assert.equal(auth.status, 200, "authorize con MOCK tendría que responder 200");

    const respuesta = await callback({
        provider: "MOCK",
        code: "mock_code_e2e",
        state: auth.body.state
    });
    assert.equal(respuesta.status, 200, `callback respondió ${respuesta.status}: ${JSON.stringify(respuesta.body)}`);

    return respuesta.body;
}

// Resultado del primer login, reutilizado en los bloques siguientes.
let sesion;

describe("AE4 - RF-1.5 Proveedores y autorización", () => {
    before(async () => {
        const health = await api("/health");
        assert.equal(health.status, 200, "M1 no responde en /health: ¿está levantado?");
    });

    test("GET /auth/oauth2/providers lista MOCK, GOOGLE y AUTH0 con su estado", async () => {
        const respuesta = await api("/auth/oauth2/providers");

        assert.equal(respuesta.status, 200);
        const nombres = respuesta.body.providers.map((p) => p.provider).sort();
        assert.deepEqual(nombres, ["AUTH0", "GOOGLE", "MOCK"]);

        const mock = respuesta.body.providers.find((p) => p.provider === "MOCK");
        assert.equal(mock.configured, true, "MOCK tiene que estar siempre disponible");

        for (const p of respuesta.body.providers) {
            assert.equal(typeof p.configured, "boolean", `${p.provider} sin campo configured`);
        }
    });

    test("GET /auth/oauth2/authorize devuelve la URL del proveedor con state y PKCE S256", async () => {
        const respuesta = await autorizar("MOCK");

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.body.provider, "MOCK");

        const url = new URL(respuesta.body.authorizationUrl);
        assert.equal(url.searchParams.get("response_type"), "code");
        assert.equal(url.searchParams.get("state"), respuesta.body.state);
        assert.ok(url.searchParams.get("code_challenge"), "falta code_challenge (PKCE)");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.match(url.searchParams.get("scope"), /openid/);

        // El state es un JWT firmado por M1 (tres partes separadas por punto).
        assert.equal(respuesta.body.state.split(".").length, 3, "el state no es un JWT firmado");
    });

    test("Cada authorize genera un state y un code_challenge distintos", async () => {
        const a = await autorizar("MOCK");
        const b = await autorizar("MOCK");

        assert.notEqual(a.body.state, b.body.state);
        assert.notEqual(
            new URL(a.body.authorizationUrl).searchParams.get("code_challenge"),
            new URL(b.body.authorizationUrl).searchParams.get("code_challenge")
        );
    });

    test("authorize con redirect=true responde 302 hacia el proveedor", async () => {
        const respuesta = await fetch(`${BASE_URL}/auth/oauth2/authorize?provider=MOCK&redirect=true`, {
            redirect: "manual"
        });

        assert.equal(respuesta.status, 302);
        assert.match(respuesta.headers.get("location") ?? "", /^http:\/\/mock-idp\.local\/authorize\?/);
    });

    test("authorize sin provider o con un proveedor desconocido responde 400", async () => {
        const sinProvider = await api("/auth/oauth2/authorize");
        assert.equal(sinProvider.status, 400);

        const desconocido = await autorizar("FACEBOOK");
        assert.equal(desconocido.status, 400);
    });
});

describe("AE4 - RF-1.5 Flujo completo authorize -> callback -> JWT de M1", () => {
    test("El callback canjea el code y M1 emite su propio JWT", async () => {
        sesion = await loginConMock();

        assert.ok(sesion.token, "falta el token");
        assert.equal(sesion.tokenType, "Bearer");
        assert.equal(sesion.provider, "MOCK");
        assert.equal(sesion.usuario.email, EMAIL_MOCK);
        assert.ok(sesion.usuario.id, "falta el id del usuario local");
        assert.equal(sesion.usuario.estado, "ACTIVO");
        assert.equal(sesion.usuario.password_hash, undefined);
    });

    test("Con ese JWT, GET /auth/me devuelve al usuario vinculado", async () => {
        const respuesta = await api("/auth/me", { token: sesion.token });

        assert.equal(respuesta.status, 200, JSON.stringify(respuesta.body));
        assert.match(JSON.stringify(respuesta.body), new RegExp(EMAIL_MOCK.replace(/\./g, "\\.")));
        assert.doesNotMatch(JSON.stringify(respuesta.body), /password/);
    });

    test("Otro módulo valida el JWT en /auth/validar-identidad-y-rol y recibe valid: true", async () => {
        const respuesta = await api("/auth/validar-identidad-y-rol", { token: sesion.token });

        assert.equal(respuesta.status, 200, JSON.stringify(respuesta.body));
        assert.equal(respuesta.body.valid, true);
        assert.equal(respuesta.body.userId, sesion.usuario.id);
        assert.equal(respuesta.body.role, sesion.usuario.rol);
    });

    test("GET /auth/oauth2/userinfo muestra el proveedor MOCK vinculado", async () => {
        const respuesta = await api("/auth/oauth2/userinfo", { token: sesion.token });

        assert.equal(respuesta.status, 200);
        assert.equal(respuesta.body.authMethod, "oauth2");
        assert.ok(
            respuesta.body.linkedProviders.some((p) => p.provider === "MOCK"),
            "MOCK no figura entre los proveedores vinculados"
        );
    });

    test("Un segundo login con la misma identidad externa reutiliza el mismo usuario (no duplica)", async () => {
        const otraSesion = await loginConMock();

        assert.equal(otraSesion.usuario.id, sesion.usuario.id);
        assert.notEqual(otraSesion.token, undefined);
    });
});

describe("AE4 - RF-1.5 Errores del callback", () => {
    test("Sin code responde 400 missing_code", async () => {
        const auth = await autorizar("MOCK");
        const respuesta = await callback({ provider: "MOCK", state: auth.body.state });

        assert.equal(respuesta.status, 400);
        assert.equal(respuesta.body.code, "missing_code");
    });

    test("Sin state responde 400 missing_state", async () => {
        const respuesta = await callback({ provider: "MOCK", code: "mock_code_e2e" });

        assert.equal(respuesta.status, 400);
        assert.equal(respuesta.body.code, "missing_state");
    });

    test("Con el state adulterado responde 400 invalid_state (protección CSRF)", async () => {
        const auth = await autorizar("MOCK");
        const partes = auth.body.state.split(".");
        partes[2] = partes[2].split("").reverse().join("");

        const respuesta = await callback({
            provider: "MOCK",
            code: "mock_code_e2e",
            state: partes.join(".")
        });

        assert.equal(respuesta.status, 400);
        assert.equal(respuesta.body.code, "invalid_state");
        assert.equal(respuesta.body.token, undefined);
    });

    test("Con un code que el proveedor rechaza responde 400 invalid_grant", async () => {
        const auth = await autorizar("MOCK");
        const respuesta = await callback({ provider: "MOCK", code: "invalid_code", state: auth.body.state });

        assert.equal(respuesta.status, 400);
        assert.equal(respuesta.body.code, "invalid_grant");
    });

    test("Si el proveedor no responde a tiempo, M1 responde 504 sin caerse", async () => {
        const auth = await autorizar("MOCK");
        const respuesta = await callback({ provider: "MOCK", code: "mock_code_timeout", state: auth.body.state });

        assert.equal(respuesta.status, 504);
        assert.equal(respuesta.body.code, "gateway_timeout");

        const health = await api("/health");
        assert.equal(health.status, 200, "M1 dejó de responder después del timeout del proveedor");
    });
});
