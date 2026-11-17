import amqp from 'amqplib';
export class RabbitMqEventPublisher {
    url;
    exchange;
    connection;
    channel;
    constructor(url, exchange = 'viajes') {
        this.url = url;
        this.exchange = exchange;
    }
    async publish(routingKey, payload) {
        const channel = await this.getChannel();
        const message = Buffer.from(JSON.stringify(payload));
        const options = {
            contentType: 'application/json',
            persistent: true,
        };
        if (routingKey === 'despacho.reabrir') {
            channel.sendToQueue(routingKey, message, options);
            return;
        }
        channel.publish(this.exchange, routingKey, message, options);
    }
    async close() {
        await this.channel?.close();
        await this.connection?.close();
    }
    async getChannel() {
        if (this.channel)
            return this.channel;
        const connection = await amqp.connect(this.url);
        const channel = await connection.createChannel();
        await channel.assertExchange(this.exchange, 'topic', { durable: true });
        await channel.assertQueue('despacho.reabrir', { durable: true });
        this.connection = connection;
        this.channel = channel;
        return channel;
    }
}
