import { z } from 'zod';

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

export const updateLocationSchema = coordinatesSchema.extend({
  vehicleType: z.enum(['AUTO', 'MOTO']),
  available: z.boolean().default(true),
  timestamp: z.string().datetime().optional()
});

export const updateAvailabilitySchema = z.object({
  available: z.boolean()
});

export const nearbyQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  vehicleType: z.enum(['AUTO', 'MOTO']),
  radiusKm: z.coerce.number().positive().max(50).default(5),
  limit: z.coerce.number().int().positive().max(50).optional(),
  maxCandidates: z.coerce.number().int().positive().max(50).optional()
});

export const geocodeSchema = z.object({
  address: z.string().trim().min(3).max(200)
});

export const estimateSchema = z.object({
  origin: coordinatesSchema,
  destination: coordinatesSchema
});
