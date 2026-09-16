import express from 'express';

interface TarifaRequestBody {
  vehiculo?: unknown;
}

export const createM7StubApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.post('/tarifas/estimar', (request, response) => {
    const { vehiculo } = request.body as TarifaRequestBody;
    response.status(200).json({
      tarifaEstimada: vehiculo === 'MOTO' ? 1_500 : 2_500,
      moneda: 'ARS',
    });
  });
  return app;
};
