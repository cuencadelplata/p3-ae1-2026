import { UserRole } from "./user.types";

export interface RegisterUserRequestDTO {
    nombre: string;
    apellido: string;
    dni: string;
    telefono: string;
    email: string;
    password: string;
    rol: 'CLIENTE' | 'CONDUCTOR'; // Excluimos OPERADOR del registro público
}

export interface RegisterUserResponseDTO {
    id: number;
    nombre: string;
    apellido: string;
    email: string;
    rol: UserRole;
    created_at: string;
}
