import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

export const publicarEvento = async (exchange: string, routingKey: string, mensaje: any) => {
    try {
        const conexion = await amqp.connect(RABBITMQ_URL);
        const canal = await conexion.createChannel();
        
        await canal.assertExchange(exchange, 'direct', { durable: true });
        canal.publish(exchange, routingKey, Buffer.from(JSON.stringify(mensaje)));
        
        console.log(`[RabbitMQ] Evento asíncrono publicado en ${exchange} -> ${routingKey}`);
        
        setTimeout(() => {
            canal.close();
            conexion.close();
        }, 500);
    } catch (error) {
        console.error('[RabbitMQ] Error al publicar evento:', error);
    }
};