import {
    describe,
    expect,
    it
} from "vitest";

import {
    esEmailValido,
    esPasswordValida,
    esRolValido,
    normalizarEmail
} from "../../src/utils/auth.validators";

describe(
    "Validaciones de identidad y acceso",
    () => {
        it(
            "Normalizar un email",
            () => {
                expect(
                    normalizarEmail(
                        "  Usuario@EMAIL.COM  "
                    )
                ).toBe("usuario@email.com");
            }
        );

        it(
            "Validar formatos de email",
            () => {
                expect(
                    esEmailValido(
                        "usuario@email.com"
                    )
                ).toBe(true);

                expect(
                    esEmailValido(
                        "email-invalido"
                    )
                ).toBe(false);
            }
        );

        it(
            "Exigir una contraseña de al menos seis caracteres",
            () => {
                expect(
                    esPasswordValida("123456")
                ).toBe(true);

                expect(
                    esPasswordValida("12345")
                ).toBe(false);
            }
        );

        it(
            "Aceptar los tres roles definidos",
            () => {
                expect(
                    esRolValido("CLIENTE")
                ).toBe(true);

                expect(
                    esRolValido("CONDUCTOR")
                ).toBe(true);

                expect(
                    esRolValido("OPERADOR")
                ).toBe(true);

                expect(
                    esRolValido("ROL_INVALIDO")
                ).toBe(false);
            }
        );
    }
);