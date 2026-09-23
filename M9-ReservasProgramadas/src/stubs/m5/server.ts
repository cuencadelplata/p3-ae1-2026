import { z } from 'zod';
import { CHOFERES_DEMO, createM5StubApp } from './app.js';
import type { RespuestaSimulada } from './ofertas.js';

const port = Number(process.env.PORT ?? 3001);

const escenario = z
  .enum(['ACEPTAN', 'RECHAZA_MEJOR', 'VENCE_MEJOR', 'RECHAZAN_TODOS'])
  .default('ACEPTAN')
  .parse(process.env.M5_OFERTAS_ESCENARIO);
const choferes = CHOFERES_DEMO.map((c, i) => {
  let respuestaSimulada: RespuestaSimulada = 'ACEPTAR';
  if (escenario === 'RECHAZAN_TODOS' || (escenario === 'RECHAZA_MEJOR' && i === 0))
    respuestaSimulada = 'RECHAZAR';
  if (escenario === 'VENCE_MEJOR' && i === 0) respuestaSimulada = 'SIN_RESPUESTA';
  return { ...c, respuestaSimulada };
});

createM5StubApp(choferes).listen(port, () => {
  console.log(`M5 stub escuchando en el puerto ${port}.`);
});
