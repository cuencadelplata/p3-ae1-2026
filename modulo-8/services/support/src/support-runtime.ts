import { createSupportApp } from './app.js';
import type { SupportConfig } from './config/env.js';
import {
  LegacyRabbitSupportEventPublisher,
  NoopSupportEventPublisher,
} from './events/support-event-publisher.js';
import { RabbitMQConsumer } from './rabbitmq/consumer.js';
import type { TicketRepository } from './repositories/ticket.repository.js';
import { TicketService } from './services/ticket.service.js';

// Arma las dependencias de Support según la configuración. No abre puertos
// ni conecta al broker hasta que el entrypoint lo pide.
export function createSupportRuntime(config: SupportConfig, ticketRepository: TicketRepository) {
  const eventPublisher = config.legacyEvents
    ? new LegacyRabbitSupportEventPublisher()
    : new NoopSupportEventPublisher();
  const ticketService = new TicketService(ticketRepository, eventPublisher);
  const app = createSupportApp({ ticketService, legacyEvents: config.legacyEvents });

  return {
    app,

    // Inicia el consumo asíncrono (RF-8.6) sólo si lo heredado de AE1 está habilitado.
    async startLegacyEvents() {
      if (!config.legacyEvents) return;
      await RabbitMQConsumer.connect(config.rabbitUrl);
    },
  };
}
