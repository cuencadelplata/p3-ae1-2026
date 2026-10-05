export interface SupportConfig {
  port: string | number;
  rabbitUrl: string;
  // Publicación de ticket.* y consumer RabbitMQ heredados de AE1.
  legacyEvents: boolean;
}

export function loadSupportConfig(env: NodeJS.ProcessEnv = process.env): SupportConfig {
  const legacyEvents = env.SUPPORT_LEGACY_EVENTS ?? 'on';
  if (legacyEvents !== 'on' && legacyEvents !== 'off') {
    throw new Error(`SUPPORT_LEGACY_EVENTS debe ser "on" u "off" (recibido: "${legacyEvents}")`);
  }

  return {
    port: env.PORT || 3000,
    rabbitUrl: env.RABBITMQ_URL || 'amqp://localhost:5672',
    legacyEvents: legacyEvents === 'on',
  };
}
