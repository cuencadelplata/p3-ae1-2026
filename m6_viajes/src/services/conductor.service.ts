import axios from 'axios';

const M3_URL = process.env.M3_URL || 'http://localhost:4003';
const M3_TIMEOUT_MS = Number(process.env.M3_TIMEOUT_MS) || 3000;

const cliente = axios.create({
    baseURL: M3_URL,
    timeout: M3_TIMEOUT_MS,
});

export interface EstadoConductorResponse {
    conductorId: string;
    habilitado: boolean;
    vehiculo?: string;
}

// RF-6.2: consultar a M3 si el conductor asignado está habilitado.
// Endpoint propuesto. Debe confirmarlo el grupo de M3.
export async function consultarEstadoConductor(
    conductorId: string
): Promise<EstadoConductorResponse> {
    try {
        const { data } = await cliente.get(
            `/api/v1/conductores/${conductorId}/estado`
        );

        return data;
    } catch (error) {
        throw new Error('M3_NO_DISPONIBLE');
    }
}