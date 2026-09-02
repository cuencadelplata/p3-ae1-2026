export type UserRole =
    | "CLIENTE"
    | "CONDUCTOR"
    | "OPERADOR";

export type UserStatus =
    | "ACTIVO"
    | "BLOQUEADO";

export type OAuth2Provider =
    | "GOOGLE"
    | "GITHUB"
    | "MICROSOFT"
    | "CUSTOM";

export type OAuth2Status =
    | "ACTIVO"
    | "DESVINCULADO";

export interface UserRow {
    id: number;
    nombre: string;
    apellido: string;
    dni: string;
    telefono: string;
    email: string;
    password_hash: string;
    rol: UserRole;
    estado: UserStatus;
    created_at: string;
}

export interface PasswordRecoveryTokenRow {
    id: number;
    usuario_id: number;
    token: string;
    expires_at: string;
    used: boolean;
    used_at: string | null;
    created_at: string;
}

export interface OAuth2ProviderRow {
    id: number;
    usuario_id: number;
    provider_name: OAuth2Provider;
    provider_user_id: string;
    provider_email: string | null;
    estado: OAuth2Status;
    created_at: string;
}