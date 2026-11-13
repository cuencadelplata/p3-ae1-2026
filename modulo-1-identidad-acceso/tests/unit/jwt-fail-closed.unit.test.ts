import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJwtSecret, INSECURE_DEFAULT_SECRETS } from "../../src/config/env";

describe("Seguridad JWT - Política Fail-Closed (Punto 1)", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("En desarrollo, si no hay JWT_SECRET, usa la clave local de desarrollo", () => {
        delete process.env.JWT_SECRET;
        process.env.NODE_ENV = "development";

        const secret = getJwtSecret();
        expect(secret).toBe("clave-local-desarrollo-m1-cambiar-en-produccion");
    });

    it("En producción (NODE_ENV=production), si JWT_SECRET no está definido, lanza error (Fail-Closed)", () => {
        delete process.env.JWT_SECRET;
        process.env.NODE_ENV = "production";

        expect(() => getJwtSecret()).toThrowError(/Fail-Closed/i);
    });

    it("En producción, rechaza cualquier clave por defecto insegura", () => {
        process.env.NODE_ENV = "production";

        for (const defaultSecret of INSECURE_DEFAULT_SECRETS) {
            process.env.JWT_SECRET = defaultSecret;
            expect(() => getJwtSecret()).toThrowError(/Fail-Closed/i);
        }
    });

    it("En producción, acepta un JWT_SECRET válido y seguro", () => {
        process.env.NODE_ENV = "production";
        process.env.JWT_SECRET = "mi-clave-super-secreta-de-produccion-2026-ucp";

        expect(getJwtSecret()).toBe("mi-clave-super-secreta-de-produccion-2026-ucp");
    });
});

