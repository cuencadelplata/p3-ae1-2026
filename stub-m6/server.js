// Mock ligero del Módulo 6 (Viajes) - Sin dependencias externas
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8080;

const sampleTrips = {
  'cust_823a7b9c': [
    {
      tripId: 'trip_99217c2f',
      origin: 'Av. Colón 1200, Córdoba',
      destination: 'Av. General Paz 250, Córdoba',
      fare: 1850.00,
      status: 'COMPLETADO',
      createdAt: '2026-08-29T14:20:00Z'
    },
    {
      tripId: 'trip_88201a4e',
      origin: 'Plaza España, Córdoba',
      destination: 'Aeropuerto Córdoba',
      fare: 5200.00,
      status: 'COMPLETADO',
      createdAt: '2026-08-28T09:15:00Z'
    }
  ]
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'UP', service: 'm6-stub-viajes' }));
    return;
  }

  // GET /v1/trips?customerId={id}
  if (req.method === 'GET' && parsedUrl.pathname === '/v1/trips') {
    const customerId = parsedUrl.query.customerId;

    if (!customerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'BadRequest', message: 'El parámetro customerId es obligatorio' }));
      return;
    }

    const trips = sampleTrips[customerId] || [
      {
        tripId: `trip_${Math.random().toString(16).slice(2, 10)}`,
        origin: 'Patio Olmos, Córdoba',
        destination: 'Ciudad Universitaria, Córdoba',
        fare: 1450.00,
        status: 'COMPLETADO',
        createdAt: new Date().toISOString()
      }
    ];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      customerId,
      tripsCount: trips.length,
      trips
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NotFound', message: 'Ruta no encontrada en el stub de M6' }));
});

server.listen(PORT, () => {
  console.log(`[m6-stub-viajes] Escuchando en http://0.0.0.0:${PORT}`);
});
