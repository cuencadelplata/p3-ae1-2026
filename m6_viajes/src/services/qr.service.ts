import axios from 'axios';

const M8_URL = process.env.M8_URL || 'http://localhost:4001';
const M8_TIMEOUT_MS = Number(process.env.M8_TIMEOUT_MS) || 3000;

// Excelente decisión usar una instancia separada con timeout
const cliente = axios.create({ baseURL: M8_URL, timeout: M8_TIMEOUT_MS });

export interface GenerarQRResponse {
    codigo: string;
}

export interface ValidarQRResponse {
    valido: boolean;
    motivo?: string;
}

// ---> ESTA ES LA FUNCIÓN QUE FALTABA <---
export async function generarQR(tripId: string): Promise<GenerarQRResponse> {
    try {
        const { data } = await cliente.post('/qr', { tripId });
        return data;
    } catch (error) {
        throw new Error('503_SERVICE_UNAVAILABLE');
    }
}

export async function validarQR(tripId: string, codigo: string): Promise<ValidarQRResponse> {
    try {
        const { data } = await cliente.post('/qr/validate', { tripId, codigo });
        return data;
    } catch (error: any) {
        // 1. El servicio M8 está apagado, la red falló, o tardó más de 3000ms (Timeout)
        if (error.code === 'ECONNABORTED' || !error.response) {
            throw new Error('503_SERVICE_UNAVAILABLE');
        }
        
        // 2. M8 respondió, pero el QR es incorrecto (Ej: HTTP 400 Bad Request)
        if (error.response.status === 400) {
            throw new Error('400_BAD_REQUEST: QR inválido o expirado');
        }
        
        // 3. Fallo general del lado del servidor M8 (Ej: HTTP 500)
        throw new Error('500_INTERNAL_ERROR: Error al validar con el proveedor');
    }
}