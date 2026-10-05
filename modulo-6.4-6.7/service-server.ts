import { createViajeApi, HttpViajesApiClient } from './src/m6-rf-6.4-rf6.7/api.js';

const server = createViajeApi({
  viajesApi: new HttpViajesApiClient(
    process.env.RF6_API_URL ?? 'http://127.0.0.1:3000',
  ),
});
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log(`API M6 escuchando en ${process.env.PORT ?? 3000}`);
});