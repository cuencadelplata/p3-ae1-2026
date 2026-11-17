import axios from 'axios';
import { createHash } from 'node:crypto';

const M8_URL = process.env.M8_URL || 'http://localhost:3103';
const M8_TIMEOUT_MS = Number(process.env.M8_TIMEOUT_MS) || 3000;
const M8_QR_API_KEY = process.env.M8_QR_API_KEY;
const IDEMPOTENCY_NAMESPACE = Buffer.from('2ba7d4a0846e4e8bbc2c4c777a937d5a', 'hex');
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

export function crearClaveIdempotenciaQR(tripId: string, token: string): string {
    const hash = createHash('sha1')
        .update(IDEMPOTENCY_NAMESPACE)
        .update(`${tripId}\0${token}`)
        .digest();
    const bytes = Buffer.from(hash.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function serviceHeaders(idempotencyKey?: string): Record<string, string> {
    return {
        ...(M8_QR_API_KEY ? { 'x-api-key': M8_QR_API_KEY } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    };
}

export async function generarQR(tripId: string): Promise<GenerarQRResponse> {
    try {
        const response = await cliente.post('/qr', { tripId }, { headers: serviceHeaders() });
        if (response.status !== 201) {
            throw new M8ApiError(502, 'M8_UNEXPECTED_STATUS');
        }
        const { data } = response;
        return data as GenerarQRResponse;
    } catch (error) {
        throw toM8ApiError(error);
    }
}

export async function validarQR(tripId: string, token: string): Promise<ValidarQRResponse> {
    try {
        const idempotencyKey = crearClaveIdempotenciaQR(tripId, token);
        const response = await cliente.post('/qr/validate', { tripId, token }, {
            headers: serviceHeaders(idempotencyKey),
        });
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