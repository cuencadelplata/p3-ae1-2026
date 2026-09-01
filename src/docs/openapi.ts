export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'M9 – Reservas Programadas',
    version: '0.1.0',
    description: 'API del microservicio M9. Infraestructura inicial.',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Consultar el estado básico del servicio',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'El servicio está disponible.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse',
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['service', 'status'],
        additionalProperties: false,
        properties: {
          service: {
            type: 'string',
            example: 'm9-reservas-programadas',
          },
          status: {
            type: 'string',
            enum: ['ok'],
          },
        },
      },
    },
  },
} as const;
