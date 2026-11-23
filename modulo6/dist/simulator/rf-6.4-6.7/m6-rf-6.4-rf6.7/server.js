import { createServer } from 'node:http';
export function createSimulator() {
    return createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request)
            body += chunk;
        const input = body ? JSON.parse(body) : {};
        let result;
        if (request.method === 'GET' && request.url?.match(/^(?:\/api)?\/conductor\/[^/]+\/estado$/)) {
            result = { habilitado: true };
        }
        else if (request.method === 'POST' && request.url === '/api/v1/estimate') {
            const origin = asCoordinates(input.origin);
            const destination = asCoordinates(input.destination);
            if (!origin || !destination) {
                response.writeHead(400, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'Coordenadas de origen y destino inválidas' }));
                return;
            }
            const distanceKm = haversineDistance(origin, destination);
            result = {
                distanceKm: Math.round(distanceKm * 100) / 100,
                estimatedEtaMinutes: Math.max(1, Math.ceil((distanceKm / 25) * 60)),
            };
        }
        if (result) {
            const isEstimate = request.url === '/api/v1/estimate';
            response.writeHead(isEstimate ? 200 : 201, { 'content-type': 'application/json' });
            response.end(JSON.stringify(result));
            return;
        }
        if (request.url === '/api/tarifas/estimacion') {
            result = { total: 150 + Number(input.distanciaKm) * 80 + Number(input.tiempoMinutos) * 25 };
        }
        else {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
    });
}
function asCoordinates(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const coordinates = value;
    const { latitude, longitude } = coordinates;
    if (typeof latitude !== 'number' ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        typeof longitude !== 'number' ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180) {
        return undefined;
    }
    return { latitude, longitude };
}
function haversineDistance(origin, destination) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const latitudeDelta = toRadians(destination.latitude - origin.latitude);
    const longitudeDelta = toRadians(destination.longitude - origin.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(toRadians(origin.latitude)) *
            Math.cos(toRadians(destination.latitude)) *
            Math.sin(longitudeDelta / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
if (process.argv[1]?.endsWith('/server.js') || process.argv[1]?.endsWith('simulator/server.js')) {
    const server = createSimulator();
    server.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () => {
        console.log(`Simulador de APIs escuchando en ${process.env.PORT ?? 3001}`);
    });
}
