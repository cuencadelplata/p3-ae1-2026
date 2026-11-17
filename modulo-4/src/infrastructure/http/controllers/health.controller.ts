import type { Request, Response } from 'express';
import type { LocationRepository } from '../../../ports/location-repository.port.js';
import type { RabbitMQConnection } from '../../rabbitmq/rabbitmq.connection.ts';

export class HealthController {
  public constructor(
    private readonly locationRepository: LocationRepository,
    private readonly rabbitmqConnection?: RabbitMQConnection
  ) {}

  public getLiveness = (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'UP',
      service: 'm4-location-service',
      timestamp: new Date().toISOString()
    });
  };

  public getReadiness = async (_req: Request, res: Response): Promise<void> => {
    let redisStatus = 'down';
    let rabbitStatus = 'down';
    let isHealthy = true;

    try {
      if (this.locationRepository.ping) {
        await this.locationRepository.ping();
        redisStatus = 'connected';
      } else {
        redisStatus = 'connected';
      }
    } catch {
      isHealthy = false;
      redisStatus = 'disconnected';
    }

    if (this.rabbitmqConnection) {
      try {
        const isRabbitConnected = await this.rabbitmqConnection.isConnected();
        rabbitStatus = isRabbitConnected ? 'connected' : 'disconnected';
        if (!isRabbitConnected) {
          isHealthy = false;
        }
      } catch {
        rabbitStatus = 'error';
        isHealthy = false;
      }
    } else {
      rabbitStatus = 'disabled_or_mock';
    }

    const responseStatus = isHealthy ? 200 : 503;
    res.status(responseStatus).json({
      status: isHealthy ? 'UP' : 'DOWN',
      service: 'm4-location-service',
      checks: {
        redis: redisStatus,
        rabbitmq: rabbitStatus
      },
      timestamp: new Date().toISOString()
    });
  };
}
