import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { authenticateToken, AuthenticatedRequest } from "../../src/middleware/auth.middleware";
import { getJwtSecret } from "../../src/config/env";
import { Response } from "express";

function createMockResponse() {
    const res: Partial<Response> & { statusCode?: number; jsonData?: any } = {
        statusCode: 200,
        jsonData: undefined
    };

    res.status = vi.fn().mockImplementation((code: number) => {
        res.statusCode = code;
        return res;
    });

    res.json = vi.fn().mockImplementation((data: any) => {
        res.jsonData = data;
        return res;
    });

    return res as Response & { statusCode: number; jsonData: any };
}

describe("Seguridad JWT - Fijación de Algoritmo HS256 y Validación de Claims (Punto 2)", () => {
    const secret = getJwtSecret();

    it("Acepta un token correctamente firmado con HS256 y rol canónico", () => {
        const token = jwt.sign(
            { userId: 10, role: "CLIENTE" },
            secret,
            { algorithm: "HS256", expiresIn: "1h" }
        );

        const req = {
            headers: { authorization: `Bearer ${token}` }
        } as AuthenticatedRequest;
        const res = createMockResponse();
        const next = vi.fn();

        authenticateToken(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.usuarioAutenticado?.userId).toBe(10);
        expect(req.usuarioAutenticado?.role).toBe("CLIENTE");
    });

    it("Rechaza un token con algoritmo 'none' (Algorithm Confusion / Unsigned)", () => {
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ userId: 10, role: "CLIENTE" })).toString("base64url");
        const unsignedToken = `${header}.${payload}.`;

        const req = {
            headers: { authorization: `Bearer ${unsignedToken}` }
        } as AuthenticatedRequest;
        const res = createMockResponse();
        const next = vi.fn();

        authenticateToken(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.jsonData.error).toBe("Token inválido");
    });

    it("Rechaza un token firmado con un secreto diferente", () => {
        const token = jwt.sign(
            { userId: 10, role: "CLIENTE" },
            "clave-completamente-distinta",
            { algorithm: "HS256", expiresIn: "1h" }
        );

        const req = {
            headers: { authorization: `Bearer ${token}` }
        } as AuthenticatedRequest;
        const res = createMockResponse();
        const next = vi.fn();

        authenticateToken(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.jsonData.error).toBe("Token inválido");
    });

    it("Rechaza un token con userId <= 0 (ej: 0 o negativo)", () => {
        const tokenZero = jwt.sign(
            { userId: 0, role: "CLIENTE" },
            secret,
            { algorithm: "HS256", expiresIn: "1h" }
        );

        const reqZero = {
            headers: { authorization: `Bearer ${tokenZero}` }
        } as AuthenticatedRequest;
        const resZero = createMockResponse();
        const nextZero = vi.fn();

        authenticateToken(reqZero, resZero, nextZero);

        expect(nextZero).not.toHaveBeenCalled();
        expect(resZero.statusCode).toBe(401);
        expect(resZero.jsonData.error).toBe("Contenido del token inválido");

        const tokenNegative = jwt.sign(
            { userId: -5, role: "CLIENTE" },
            secret,
            { algorithm: "HS256", expiresIn: "1h" }
        );

        const reqNeg = {
            headers: { authorization: `Bearer ${tokenNegative}` }
        } as AuthenticatedRequest;
        const resNeg = createMockResponse();
        const nextNeg = vi.fn();

        authenticateToken(reqNeg, resNeg, nextNeg);

        expect(nextNeg).not.toHaveBeenCalled();
        expect(resNeg.statusCode).toBe(401);
        expect(resNeg.jsonData.error).toBe("Contenido del token inválido");
    });

    it("Rechaza un token con roles no canónicos de M1 (ej: ADMIN, SUPERUSER, CLIENT)", () => {
        for (const invalidRole of ["ADMIN", "SUPERUSER", "CLIENT", "guest", ""]) {
            const token = jwt.sign(
                { userId: 1, role: invalidRole },
                secret,
                { algorithm: "HS256", expiresIn: "1h" }
            );

            const req = {
                headers: { authorization: `Bearer ${token}` }
            } as AuthenticatedRequest;
            const res = createMockResponse();
            const next = vi.fn();

            authenticateToken(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);
            expect(res.jsonData.error).toBe("Contenido del token inválido");
        }
    });

    it("Acepta todos los roles canónicos de M1 (CLIENTE, CONDUCTOR, OPERADOR)", () => {
        for (const role of ["CLIENTE", "CONDUCTOR", "OPERADOR"] as const) {
            const token = jwt.sign(
                { userId: 20, role },
                secret,
                { algorithm: "HS256", expiresIn: "1h" }
            );

            const req = {
                headers: { authorization: `Bearer ${token}` }
            } as AuthenticatedRequest;
            const res = createMockResponse();
            const next = vi.fn();

            authenticateToken(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.usuarioAutenticado?.role).toBe(role);
        }
    });
});
