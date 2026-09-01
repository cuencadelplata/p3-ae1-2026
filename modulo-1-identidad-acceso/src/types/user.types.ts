export type UserRole =
    | "CLIENTE"
    | "CONDUCTOR"
    | "OPERADOR";

export type UserStatus =
    | "ACTIVO"
    | "BLOQUEADO";

export interface UserRow {
    id: number;
    email: string;
    password_hash: string;
    rol: UserRole;
    estado: UserStatus;
    created_at: string;
}