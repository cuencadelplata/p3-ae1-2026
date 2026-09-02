import {
    describe,
    expect,
    it
} from "vitest";

import {
    validateOAuth2Provider
} from "../../src/services/oauth2.service";

describe(
    "Validación de proveedores OAuth2",
    () => {
        it(
            "acepta los proveedores soportados",
            () => {
                expect(
                    validateOAuth2Provider("GOOGLE")
                ).toBe("GOOGLE");

                expect(
                    validateOAuth2Provider("GITHUB")
                ).toBe("GITHUB");

                expect(
                    validateOAuth2Provider("MICROSOFT")
                ).toBe("MICROSOFT");

                expect(
                    validateOAuth2Provider("CUSTOM")
                ).toBe("CUSTOM");
            }
        );

        it(
            "rechaza un proveedor no soportado",
            () => {
                expect(
                    () => validateOAuth2Provider("FACEBOOK")
                ).toThrow("Provider FACEBOOK no soportado");
            }
        );

        it(
            "rechaza un proveedor vacío",
            () => {
                expect(
                    () => validateOAuth2Provider("")
                ).toThrow("Provider  no soportado");
            }
        );

        it(
            "rechaza proveedores con minúsculas",
            () => {
                expect(
                    () => validateOAuth2Provider("google")
                ).toThrow("Provider google no soportado");
            }
        );

        it(
            "devuelve un error 400 para un proveedor no soportado",
            () => {
                try {
                    validateOAuth2Provider("FACEBOOK");
                    throw new Error("Se esperaba un error");
                } catch (error) {
                    expect(error).toMatchObject({
                        statusCode: 400,
                        message: "Provider FACEBOOK no soportado"
                    });
                }
            }
        );
    }
);