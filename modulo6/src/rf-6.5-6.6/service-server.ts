import { createViajeApi, HttpRf6ApiClient } from './api.js';
import { RabbitMqEventPublisher } from './rabbitmq.js';

const events = new RabbitMqEventPublisher(process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672');
const server = createViajeApi({
  rf6Api: new HttpRf6ApiClient(process.env.RF6_API_URL ?? 'http://localhost:3000'),
  events,
});
server.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () => {
  console.log(`API M6 escuchando en ${process.env.PORT ?? 3001}`);
});

async function shutdown(): Promise<void> {
  await events.close();
  server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);