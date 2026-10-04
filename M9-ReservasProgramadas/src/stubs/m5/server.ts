import { RabbitMqConnection } from '../../infrastructure/rabbitmq/rabbitmq.connection.js';
import { createM5StubApp } from './app.js';
import { createM5StubState } from './app.js';
import { startM5StubMessaging } from './rabbitmq.js';

const port = Number(process.env.PORT ?? 3001);
const retryDelayMs = Number(process.env.RABBITMQ_RETRY_DELAY_MS ?? 1_000);
const state = createM5StubState();
const rabbitMq = new RabbitMqConnection(
  process.env.RABBITMQ_URL ?? 'amqp://m9:m9-local@localhost:5672',
  {
    exchange: process.env.RABBITMQ_EXCHANGE ?? 'm9.reservas.events',
    retryExchange: process.env.RABBITMQ_RETRY_EXCHANGE ?? 'm9.reservas.events.retry',
    deadLetterExchange: process.env.RABBITMQ_DLQ_EXCHANGE ?? 'm9.reservas.events.dlx',
    queue: process.env.M5_RABBITMQ_QUEUE ?? 'm5.reservas-dispatch-demo',
    retryQueue: process.env.M5_RABBITMQ_RETRY_QUEUE ?? 'm5.reservas-dispatch-demo.retry',
    deadLetterQueue: process.env.M5_RABBITMQ_DLQ ?? 'm5.reservas-dispatch-demo.dlq',
    retryDelayMs,
  },
);

await rabbitMq.connect();
await startM5StubMessaging(rabbitMq, state, Number(process.env.RABBITMQ_RETRY_LIMIT ?? 3));

const server = createM5StubApp(state).listen(port, () => {
  console.log(`M5 contract stub escuchando en el puerto ${port}.`);
});

const shutdown = (): void => {
  server.close(() => void rabbitMq.close());
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
