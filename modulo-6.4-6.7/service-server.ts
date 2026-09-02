import { createViajeApi, HttpExternalApisClient } from './src/api.js';

const server = createViajeApi({
  externalApis: new HttpExternalApisClient(process.env.SIMULATOR_URL ?? 'http://127.0.0.1:3001'),
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log(`API M6 escuchando en ${process.env.PORT ?? 3000}`);
});