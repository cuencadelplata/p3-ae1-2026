import db from "../config/database";
import {
    UserRole,
    UserRow,
    PasswordRecoveryTokenRow,
    OAuth2ProviderRow,
    OAuth2Provider
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

export function findUserById(
    id: number
): UserRow | undefined {
    return db
        .prepare(
            "SELECT * FROM usuarios WHERE id = ?"
        )
        .get(id) as UserRow | undefined;
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

// ============ Password Recovery Functions ============

export function createPasswordRecoveryToken(
    usuarioId: number,
    token: string,
    expiresAtMs: number
): number {
    const expiresAt = new Date(expiresAtMs)
        .toISOString();

    const result = db
        .prepare(`
            INSERT INTO password_recovery_tokens (
                usuario_id,
                token,
                expires_at,
                used
            )
            VALUES (?, ?, ?, FALSE)
        `)
        .run(usuarioId, token, expiresAt);

    return Number(result.lastInsertRowid);
}

export function findRecoveryTokenByToken(
    token: string
): PasswordRecoveryTokenRow | undefined {
    return db
        .prepare(
            "SELECT * FROM password_recovery_tokens WHERE token = ? AND used = FALSE"
        )
        .get(token) as PasswordRecoveryTokenRow | undefined;
}

export function markRecoveryTokenAsUsed(
    tokenId: number
): void {
    db.prepare(`
        UPDATE password_recovery_tokens
        SET used = TRUE, used_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(tokenId);
}

export function updateUserPassword(
    usuarioId: number,
    newPasswordHash: string
): void {
    db.prepare(`
        UPDATE usuarios
        SET password_hash = ?
        WHERE id = ?
    `).run(newPasswordHash, usuarioId);
}

// ============ OAuth2 Functions ============

export function createOAuth2Provider(
    usuarioId: number,
    providerName: OAuth2Provider,
    providerUserId: string,
    providerEmail?: string
): number {
    const result = db
        .prepare(`
            INSERT INTO oauth2_providers (
                usuario_id,
                provider_name,
                provider_user_id,
                provider_email,
                estado
            )
            VALUES (?, ?, ?, ?, 'ACTIVO')
        `)
        .run(
            usuarioId,
            providerName,
            providerUserId,
            providerEmail || null
        );

    return Number(result.lastInsertRowid);
}

export function findOAuth2ProviderByProviderUserId(
    providerName: OAuth2Provider,
    providerUserId: string
): OAuth2ProviderRow | undefined {
    return db
        .prepare(`
            SELECT * FROM oauth2_providers
            WHERE provider_name = ? AND provider_user_id = ? AND estado = 'ACTIVO'
        `)
        .get(providerName, providerUserId) as OAuth2ProviderRow | undefined;
}

export function findOAuth2ProvidersByUserId(
    usuarioId: number
): OAuth2ProviderRow[] {
    return db
        .prepare(`
            SELECT * FROM oauth2_providers
            WHERE usuario_id = ? AND estado = 'ACTIVO'
        `)
        .all(usuarioId) as OAuth2ProviderRow[];
}