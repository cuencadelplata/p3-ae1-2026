import { createSupportApp } from './app.js';
import { ticketRepository } from './models/ticket.model.js';
import { RabbitMQConsumer } from './rabbitmq/consumer.js';
import { TicketService } from './services/ticket.service.js';

const app = createSupportApp({ ticketService: new TicketService(ticketRepository) });

const PORT = process.env.PORT || 3000;
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

app.listen(PORT, async () => {
  console.log(`[Server] Microservicio M8-Soporte ejecutándose en puerto ${PORT}`);

  // Iniciamos el consumo asíncrono (RF-8.6)
  await RabbitMQConsumer.connect(RABBIT_URL);
});
