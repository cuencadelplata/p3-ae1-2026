import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  locationTtlSeconds: number;
  m1Url: string;
  m3Url: string;
  redisUrl: string;
  redisKeyPrefix: string;
  postgresUrl: string;
  rabbitmqUrl: string;
  rabbitmqTripExchange: string;
  rabbitmqTripStartedKey: string;
  rabbitmqTripCompletedKey: string;
  rabbitmqTripCancelledKey: string;
  geocodingProviderUrl: string;
  geocodingApiKey: string;
  geocodingTimeoutMs: number;
  useMockGeocoding: boolean;
  skipAuthValidation: boolean;
}

export const config: AppConfig = {
  port: Number(process.env.PORT || 3004),
  nodeEnv: process.env.NODE_ENV || 'development',
  locationTtlSeconds: Number(process.env.LOCATION_TTL_SECONDS || 60),
  m1Url: process.env.M1_URL || 'http://localhost:3001',
  m3Url: process.env.M3_URL || 'http://localhost:3003',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  redisKeyPrefix: process.env.REDIS_KEY_PREFIX || 'driver:',
  postgresUrl: process.env.POSTGRES_URL || 'postgres://postgres:postgres@127.0.0.1:5432/m4_locations',
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://guest:guest@127.0.0.1:5672',
  rabbitmqTripExchange: process.env.RABBITMQ_TRIP_EVENTS_EXCHANGE || 'trip.events',
  rabbitmqTripStartedKey: process.env.RABBITMQ_TRIP_STARTED_KEY || 'TripStarted',
  rabbitmqTripCompletedKey: process.env.RABBITMQ_TRIP_COMPLETED_KEY || 'TripCompleted',
  rabbitmqTripCancelledKey: process.env.RABBITMQ_TRIP_CANCELLED_KEY || 'TripCancelled',
  geocodingProviderUrl: process.env.GEOCODING_PROVIDER_URL || 'https://nominatim.openstreetmap.org/search',
  geocodingApiKey: process.env.GEOCODING_API_KEY || '',
  geocodingTimeoutMs: Number(process.env.GEOCODING_TIMEOUT_MS || 5000),
  useMockGeocoding: process.env.USE_MOCK_GEOCODING === 'true' || process.env.NODE_ENV === 'test',
  skipAuthValidation: process.env.SKIP_AUTH_VALIDATION === 'true' || process.env.NODE_ENV === 'test'
};
