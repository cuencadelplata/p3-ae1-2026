import axios from 'axios';

const M8_URL = process.env.M8_URL || 'http://localhost:4001';
const M8_TIMEOUT_MS = Number(process.env.M8_TIMEOUT_MS) || 3000;

const cliente = axios.create({ baseURL: M8_URL, timeout: M8_TIMEOUT_MS });

export interface GenerarQRResponse {
    codigo: string;
}

export interface ValidarQRResponse {
    valido: boolean;
    motivo?: string;
}

export async function generarQR(tripId: string): Promise<GenerarQRResponse> {
    try {
        const { data } = await cliente.post('/qr', { tripId });
        return data;
    } catch (error) {
        throw new Error('M8_NO_DISPONIBLE');
    }
}

export async function validarQR(tripId: string, codigo: string): Promise<ValidarQRResponse> {
    try {
        const { data } = await cliente.post('/qr/validate', { tripId, codigo });
        return data;
    } catch (error) {
        throw new Error('M8_NO_DISPONIBLE');
    }
}