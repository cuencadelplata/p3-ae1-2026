import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from "vitest";

import {
    OPERADOR_PASSWORD_DESARROLLO,
    asegurarOperadorSemilla
} from "../../src/config/operador-semilla";

const EMAIL = "operador@movilidad.com";

function crearBase(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
        CREATE TABLE usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT, apellido TEXT, dni TEXT, telefono TEXT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            rol TEXT NOT NULL,
            estado TEXT NOT NULL DEFAULT 'ACTIVO'
        )
    `);
    return db;
}

function operador(db: Database.Database) {
    return db.prepare("SELECT id, rol, password_hash FROM usuarios WHERE email = ?").get(EMAIL) as
        | { id: number; rol: string; password_hash: string }
        | undefined;
}

describe("RF-1.3 - Operador semilla y M1_OPERADOR_PASSWORD", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("Crea el operador con la contraseña configurada", () => {
        const db = crearBase();

        const resultado = asegurarOperadorSemilla(db, { M1_OPERADOR_PASSWORD: "Clave-Segura-1" });

        expect(resultado).toBe("creado");
        expect(operador(db)?.rol).toBe("OPERADOR");
        expect(bcrypt.compareSync("Clave-Segura-1", operador(db)!.password_hash)).toBe(true);
        expect(bcrypt.compareSync(OPERADOR_PASSWORD_DESARROLLO, operador(db)!.password_hash)).toBe(false);
    });

    it("Actualiza la contraseña de un operador que ya existía (entornos que ya lo crearon)", () => {
        const db = crearBase();
        asegurarOperadorSemilla(db, { NODE_ENV: "development" });
        const idOriginal = operador(db)!.id;

        const resultado = asegurarOperadorSemilla(db, { M1_OPERADOR_PASSWORD: "Clave-Nueva-2" });

        expect(resultado).toBe("contrasena_actualizada");
        expect(operador(db)!.id).toBe(idOriginal);
        expect(bcrypt.compareSync("Clave-Nueva-2", operador(db)!.password_hash)).toBe(true);
        expect(bcrypt.compareSync(OPERADOR_PASSWORD_DESARROLLO, operador(db)!.password_hash)).toBe(false);
    });

    it("No reescribe la contraseña si ya coincide", () => {
        const db = crearBase();
        asegurarOperadorSemilla(db, { M1_OPERADOR_PASSWORD: "Clave-Segura-1" });
        const hashAnterior = operador(db)!.password_hash;

        const resultado = asegurarOperadorSemilla(db, { M1_OPERADOR_PASSWORD: "Clave-Segura-1" });

        expect(resultado).toBe("sin_cambios");
        expect(operador(db)!.password_hash).toBe(hashAnterior);
    });

    it("Sin variable, en desarrollo crea el operador con la contraseña de desarrollo", () => {
        const db = crearBase();

        const resultado = asegurarOperadorSemilla(db, { NODE_ENV: "development" });

        expect(resultado).toBe("creado");
        expect(bcrypt.compareSync(OPERADOR_PASSWORD_DESARROLLO, operador(db)!.password_hash)).toBe(true);
    });

    it("Sin variable, en producción no crea un operador con contraseña conocida", () => {
        const db = crearBase();

        const resultado = asegurarOperadorSemilla(db, { NODE_ENV: "production" });

        expect(resultado).toBe("omitido");
        expect(operador(db)).toBeUndefined();
    });

    it("Nunca convierte en OPERADOR una cuenta existente con otro rol", () => {
        const db = crearBase();
        db.prepare("INSERT INTO usuarios (email, password_hash, rol) VALUES (?, ?, 'CLIENTE')")
            .run(EMAIL, bcrypt.hashSync("de-la-persona", 4));

        const resultado = asegurarOperadorSemilla(db, { M1_OPERADOR_PASSWORD: "Clave-Segura-1" });

        expect(resultado).toBe("omitido");
        expect(operador(db)!.rol).toBe("CLIENTE");
        expect(bcrypt.compareSync("de-la-persona", operador(db)!.password_hash)).toBe(true);
    });
});
