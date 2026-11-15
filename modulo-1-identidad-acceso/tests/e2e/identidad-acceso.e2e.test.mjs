import assert from "node:assert/strict";
import {
    describe,
    test
} from "node:test";

const BASE_URL =
    process.env.BASE_URL ??
    "http://localhost:3001";

const identificador =
    `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

const password = "123456";

const emails = {
    cliente: `cliente-${identificador}@test.com`,
    conductor: `conductor-${identificador}@test.com`,
    operador: `operador-${identificador}@test.com`
};

let tokenCliente = "";

async function apiRequest(
    ruta,
    {
        method = "GET",
        body,
        token
    } = {}
) {
    const headers = {};

    if (body !== undefined) {
        headers["Content-Type"] =
            "application/json";
    }

    if (token) {
        headers.Authorization =
            `Bearer ${token}`;
    }

    const response = await fetch(
        `${BASE_URL}${ruta}`,
        {
            method,
            headers,
            body:
                body === undefined
                    ? undefined
                    : JSON.stringify(body)
        }
    );

    const contentType =
        response.headers.get("content-type") ?? "";

    const responseBody = contentType.includes(
        "application/json"
    )
        ? await response.json()
        : await response.text();

    return {
        status: response.status,
        body: responseBody
    };
}

async function registrarUsuario(
    email,
    rol
) {
    return apiRequest(
        "/auth/registrar-usuario",
        {
            method: "POST",
            body: {
                nombre: "Usuario",
                apellido: "Prueba",
                dni: "30123456",
                telefono: "11 5555 1234",
                email,
                password,
                rol
            }
        }
    );
}

async function iniciarSesion(email) {
    return apiRequest(
        "/auth/iniciar-sesion",
        {
            method: "POST",
            body: {
                email,
                password
            }
        }
    );
}

describe(
    "M1 - E2E contra contenedor",
    { concurrency: false },
    () => {
        test(
            "Comprobar la salud del contenedor",
            async () => {
                const response =
                    await apiRequest("/health");

                assert.equal(response.status, 200);
                assert.equal(
                    response.body.status,
                    "OK"
                );
            }
        );

        test(
            "Consultar la especificacion OpenAPI",
            async () => {
                const response =
                    await apiRequest(
                        "/openapi.yaml"
                    );

                assert.equal(response.status, 200);
                assert.match(
                    response.body,
                    /openapi: 3\.0\.3/
                );
            }
        );

        test(
            "RF-1.1 Registrar un cliente",
            async () => {
                const response =
                    await registrarUsuario(
                        emails.cliente,
                        "CLIENTE"
                    );

                assert.equal(response.status, 201);
                assert.equal(
                    response.body.email,
                    emails.cliente
                );
                assert.equal(
                    response.body.rol,
                    "CLIENTE"
                );
                assert.equal(
                    response.body.estado,
                    "ACTIVO"
                );
                assert.equal(
                    response.body.password_hash,
                    undefined
                );
            }
        );

        test(
            "RF-1.1 Registrar un conductor",
            async () => {
                const response =
                    await registrarUsuario(
                        emails.conductor,
                        "CONDUCTOR"
                    );

                assert.equal(response.status, 201);
                assert.equal(
                    response.body.rol,
                    "CONDUCTOR"
                );
            }
        );

        test(
            "RF-1.3 Registrar un operador",
            async () => {
                const response =
                    await registrarUsuario(
                        emails.operador,
                        "OPERADOR"
                    );

                assert.equal(response.status, 201);
                assert.equal(
                    response.body.rol,
                    "OPERADOR"
                );
            }
        );

        test(
            "Impedir el registro de un email repetido",
            async () => {
                const response =
                    await registrarUsuario(
                        emails.cliente,
                        "CLIENTE"
                    );

                assert.equal(response.status, 409);
                assert.equal(
                    response.body.error,
                    "Ya existe un usuario con ese email"
                );
            }
        );

        test(
            "RF-1.2 Iniciar sesion",
            async () => {
                const response =
                    await iniciarSesion(
                        emails.cliente
                    );

                assert.equal(response.status, 200);
                assert.equal(
                    response.body.tokenType,
                    "Bearer"
                );
                assert.equal(
                    typeof response.body.token,
                    "string"
                );

                tokenCliente = response.body.token;
            }
        );

        test(
            "Rechazar credenciales incorrectas",
            async () => {
                const response = await apiRequest(
                    "/auth/iniciar-sesion",
                    {
                        method: "POST",
                        body: {
                            email: emails.cliente,
                            password: "incorrecta"
                        }
                    }
                );

                assert.equal(response.status, 401);
                assert.equal(
                    response.body.error,
                    "Credenciales incorrectas"
                );
            }
        );

        test(
            "RF-1.3 Validar identidad y rol",
            async () => {
                const response = await apiRequest(
                    "/auth/validar-identidad-y-rol",
                    {
                        token: tokenCliente
                    }
                );

                assert.equal(response.status, 200);
                assert.equal(
                    response.body.valid,
                    true
                );
                assert.equal(
                    response.body.role,
                    "CLIENTE"
                );
                assert.equal(
                    typeof response.body.userId,
                    "number"
                );
            }
        );

        test(
            "Rechazar una solicitud sin token",
            async () => {
                const response = await apiRequest(
                    "/auth/validar-identidad-y-rol"
                );

                assert.equal(response.status, 401);
                assert.equal(
                    response.body.valid,
                    false
                );
                assert.equal(
                    response.body.error,
                    "Token requerido"
                );
            }
        );

        describe("RF-1.5 Flujo Completo OAuth2 (Proveedor MOCK)", () => {
            let oauthState = "";
            let oauthToken = "";
            let oauthUserId = 0;

            test("Consultar proveedores disponibles (GET /auth/oauth2/providers)", async () => {
                const response = await apiRequest("/auth/oauth2/providers");
                assert.equal(response.status, 200);
                assert.ok(Array.isArray(response.body.providers));
                const mockProv = response.body.providers.find((p) => p.provider === "MOCK");
                assert.ok(mockProv, "El proveedor MOCK debe estar disponible");
            });

            test("Paso 1: Iniciar autorización OAuth2 y obtener state (GET /auth/oauth2/authorize)", async () => {
                const response = await apiRequest("/auth/oauth2/authorize?provider=MOCK&role=CONDUCTOR");
                assert.equal(response.status, 200);
                assert.equal(response.body.provider, "MOCK");
                assert.ok(typeof response.body.authorizationUrl === "string");
                assert.ok(typeof response.body.state === "string");
                oauthState = response.body.state;
            });

            test("Paso 2: Procesar callback del proveedor MOCK y emitir JWT (GET /auth/oauth2/callback)", async () => {
                assert.ok(oauthState, "Debe existir un state generado");
                const response = await apiRequest(
                    `/auth/oauth2/callback?provider=MOCK&code=mock_auth_code_001&state=${encodeURIComponent(oauthState)}`
                );
                assert.equal(response.status, 200);
                assert.equal(response.body.tokenType, "Bearer");
                assert.equal(response.body.provider, "MOCK");
                assert.ok(typeof response.body.token === "string");
                assert.equal(response.body.usuario.rol, "CONDUCTOR");
                assert.ok(typeof response.body.usuario.id === "number");

                oauthToken = response.body.token;
                oauthUserId = response.body.usuario.id;
            });

            test("Paso 3: Validar identidad y rol con el token JWT obtenido (GET /auth/validar-identidad-y-rol)", async () => {
                assert.ok(oauthToken, "Debe existir un token emitido");
                const response = await apiRequest("/auth/validar-identidad-y-rol", {
                    token: oauthToken
                });
                assert.equal(response.status, 200);
                assert.equal(response.body.valid, true);
                assert.equal(response.body.role, "CONDUCTOR");
                assert.equal(response.body.userId, oauthUserId);
                assert.equal(response.body.authMethod, "oauth2");
            });

            test("Paso 4: Consultar perfil propio con el token JWT en /auth/me (Integración con otros módulos)", async () => {
                assert.ok(oauthToken, "Debe existir un token emitido");
                const response = await apiRequest("/auth/me", {
                    token: oauthToken
                });
                assert.equal(response.status, 200);
                assert.equal(response.body.userId, oauthUserId);
                assert.equal(response.body.rol, "CONDUCTOR");
                assert.equal(response.body.estado, "ACTIVO");
                assert.ok(typeof response.body.email === "string");
            });

            test("Paso 5: Consultar perfil y proveedores vinculados (GET /auth/oauth2/userinfo)", async () => {
                assert.ok(oauthToken, "Debe existir un token emitido");
                const response = await apiRequest("/auth/oauth2/userinfo", {
                    token: oauthToken
                });
                assert.equal(response.status, 200);
                assert.equal(response.body.valid, true);
                assert.equal(response.body.authMethod, "oauth2");
                assert.ok(Array.isArray(response.body.linkedProviders));
                const mockLink = response.body.linkedProviders.find((p) => p.provider === "MOCK");
                assert.ok(mockLink, "El proveedor MOCK debe estar en la lista de proveedores vinculados");
            });

            test("Paso 6: Vincular cuenta OAuth2 MOCK a un usuario existente (POST /auth/oauth2/link)", async () => {
                assert.ok(tokenCliente, "Debe existir token del usuario cliente");
                const response = await apiRequest("/auth/oauth2/link", {
                    method: "POST",
                    token: tokenCliente,
                    body: {
                        provider: "MOCK",
                        provider_id: `mock-user-${Date.now()}`
                    }
                });
                assert.equal(response.status, 200);
                assert.equal(response.body.provider, "MOCK");
            });

            test("Seguridad: Rechazar callback con state adulterado (Protección anti-CSRF)", async () => {
                const response = await apiRequest(
                    "/auth/oauth2/callback?provider=MOCK&code=mock_auth_code_001&state=state_falsificado_csrf"
                );
                assert.equal(response.status, 400);
                assert.equal(response.body.code, "invalid_state");
            });
        });
    }
);