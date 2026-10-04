import { RegisterUserRequestDTO } from "../types/auth.dto";

export function validateRegisterRequest(data: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data.nombre || typeof data.nombre !== 'string' || data.nombre.trim() === '') {
        errors.push("El nombre es obligatorio y debe ser texto.");
    }
    
    if (!data.apellido || typeof data.apellido !== 'string' || data.apellido.trim() === '') {
        errors.push("El apellido es obligatorio y debe ser texto.");
    }

    if (!data.dni || typeof data.dni !== 'string' || !/^\d{7,9}$/.test(data.dni)) {
        errors.push("El DNI es obligatorio y debe contener entre 7 y 9 números.");
    }

    if (!data.telefono || typeof data.telefono !== 'string' || data.telefono.trim() === '') {
        errors.push("El teléfono es obligatorio.");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!data.email || typeof data.email !== 'string' || !emailRegex.test(data.email)) {
        errors.push("El email es obligatorio y debe tener un formato válido.");
    }

    if (!data.password || typeof data.password !== 'string' || data.password.length < 6) {
        errors.push("La contraseña es obligatoria y debe tener al menos 6 caracteres.");
    }

    if (!data.rol || !['CLIENTE', 'CONDUCTOR'].includes(data.rol)) {
        errors.push("El rol es obligatorio y debe ser CLIENTE o CONDUCTOR.");
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}
