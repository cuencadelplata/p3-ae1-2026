import {
    describe,
    expect,
    it
} from "vitest";
import request from "supertest";

import app from "../../src/app";

describe(
    "Integración de la aplicación",
    () => {
        it(
            "responde correctamente al endpoint de salud",
            async () => {
                const response = await request(app)
                    .get("/health");

                expect(response.status).toBe(200);
                expect(response.body).toEqual({
                    status: "OK",
                    modulo: "M1 - Identidad y Acceso"
                });
            }
        );
    }
);
