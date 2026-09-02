import { UserRole } from "../types/user.types";

export const ROLES_VALIDOS: UserRole[] = [
    "CLIENTE",
    "CONDUCTOR",
    "OPERADOR"
];

export function normalizarEmail(
    email: string
): string {
    return email.trim().toLowerCase();
}

export function esEmailValido(
    email: string
): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        email
    );
}

export function esPasswordValida(
    password: string
): boolean {
    return password.length >= 6;
}

export function esRolValido(
    rol: string
): rol is UserRole {
    return ROLES_VALIDOS.includes(
        rol as UserRole
    );
}