import db from "../config/database";
import {
    UserRole,
    UserRow
} from "../types/user.types";

export function findUserByEmail(
    email: string
): UserRow | undefined {
    return db
        .prepare(
            "SELECT * FROM usuarios WHERE email = ?"
        )
        .get(email) as UserRow | undefined;
}

export function createUser(
    email: string,
    passwordHash: string,
    rol: UserRole
): number {
    const result = db
        .prepare(`
            INSERT INTO usuarios (
                email,
                password_hash,
                rol,
                estado
            )
            VALUES (?, ?, ?, 'ACTIVO')
        `)
        .run(email, passwordHash, rol);

    return Number(result.lastInsertRowid);
}