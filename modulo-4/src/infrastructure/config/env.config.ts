import dotenv from 'dotenv';
import path from 'node:path';

// Cargar variables de entorno desde .env si existe
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  locationTtlSeconds: number;
  redisUrl: string;
  redisKeyPrefix: string;
  rabbitmqUrl: string;
  geocodingProviderUrl: string;
  geocodingApiKey: string;
  geocodingTimeoutMs: number;
  useMockGeocoding: boolean;
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 3004),
  nodeEnv: process.env.NODE_ENV || 'development',
  locationTtlSeconds: Number(process.env.LOCATION_TTL_SECONDS || 60),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisKeyPrefix: process.env.REDIS_KEY_PREFIX || 'm4:driver:',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672',
  geocodingProviderUrl: process.env.GEOCODING_PROVIDER_URL || 'https://nominatim.openstreetmap.org/search',
  geocodingApiKey: process.env.GEOCODING_API_KEY || '',
  geocodingTimeoutMs: Number(process.env.GEOCODING_TIMEOUT_MS || 5000),
  useMockGeocoding: process.env.USE_MOCK_GEOCODING === 'true' || process.env.NODE_ENV === 'test'
};
