import axios from 'axios';

const M8_URL = process.env.M8_URL || 'http://localhost:3103';
const M8_TIMEOUT_MS = Number(process.env.M8_TIMEOUT_MS) || 3000;
const cliente = axios.create({ baseURL: M8_URL, timeout: M8_TIMEOUT_MS });

export class M8ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        readonly retryAfter?: string
    ) {
        super(code);
        this.name = 'M8ApiError';
    }
}

export interface GenerarQRResponse {
    token: string;
    qrDataUrl: string;
    expiresAt: string;
    codigo?: string;
}

export interface ValidarQRResponse {
    valid: boolean;
}

export async function generarQR(tripId: string): Promise<GenerarQRResponse> {
    try {
        const { data } = await cliente.post('/qr', { tripId });
        return data as GenerarQRResponse;
    } catch (error) {
        throw toM8ApiError(error);
    }
}

export async function validarQR(tripId: string, token: string): Promise<ValidarQRResponse> {
    try {
        const response = await cliente.post('/qr/validate', { tripId, token });
        if (response.status !== 200) {
            throw new M8ApiError(502, 'M8_UNEXPECTED_STATUS');
        }
        return response.data as ValidarQRResponse;
    } catch (error) {
        throw toM8ApiError(error);
    }
}

function toM8ApiError(error: unknown): M8ApiError {
    if (error instanceof M8ApiError) return error;
    if (!axios.isAxiosError(error) || !error.response) {
        return new M8ApiError(503, 'M8_UNAVAILABLE');
    }

    const responseData = asRecord(error.response.data);
    const errorData = asRecord(responseData.error);
    const code = typeof errorData.code === 'string'
        ? errorData.code
        : typeof responseData.code === 'string'
            ? responseData.code
            : `M8_HTTP_${error.response.status}`;
    const retryAfterHeader = error.response.headers['retry-after'];
    const retryAfter = Array.isArray(retryAfterHeader)
        ? retryAfterHeader[0]
        : typeof retryAfterHeader === 'string'
            ? retryAfterHeader
            : undefined;

    return new M8ApiError(error.response.status, code, retryAfter);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object'
        ? value as Record<string, unknown>
        : {};
}