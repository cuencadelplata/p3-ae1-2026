const jsonSchema = (ref: string) => ({
  content: { 'application/json': { schema: { $ref: ref } } },
});

const errorResponse = (description: string) => ({
  description,
  ...jsonSchema('#/components/schemas/ErrorResponse'),
});

const reservaResponse = (description: string) => ({
  description,
  ...jsonSchema('#/components/schemas/Reserva'),
});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'M9 – Reservas Programadas',
    version: '1.0.0',
    description: 'API REST para administrar y activar reservas programadas.',
  },
  tags: [{ name: 'Salud' }, { name: 'Reservas' }],
  paths: {
    '/health': {
      get: {
        tags: ['Salud'],
        summary: 'Consultar el estado básico del servicio',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'El servicio está disponible.',
            ...jsonSchema('#/components/schemas/HealthResponse'),
          },
        },
      },
    },
    '/reservas': {
      post: {
        tags: ['Reservas'],
        summary: 'Crear una reserva programada',
        operationId: 'crearReserva',
        requestBody: {
          required: true,
          ...jsonSchema('#/components/schemas/CrearReservaRequest'),
        },
        responses: {
          '201': reservaResponse('Reserva creada.'),
          '400': errorResponse('Datos o fecha inválidos.'),
          '500': errorResponse('Error de persistencia.'),
        },
      },
      get: {
        tags: ['Reservas'],
        summary: 'Listar reservas',
        operationId: 'listarReservas',
        responses: {
          '200': {
            description: 'Listado ordenado por fecha programada.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['reservas'],
                  properties: {
                    reservas: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Reserva' },
                    },
                  },
                },
              },
            },
          },
          '500': errorResponse('Error de persistencia.'),
        },
      },
    },
    '/reservas/{id}': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      get: {
        tags: ['Reservas'],
        summary: 'Obtener una reserva',
        operationId: 'obtenerReserva',
        responses: {
          '200': reservaResponse('Reserva encontrada.'),
          '400': errorResponse('Identificador inválido.'),
          '404': errorResponse('Reserva no encontrada.'),
          '500': errorResponse('Error de persistencia.'),
        },
      },
      patch: {
        tags: ['Reservas'],
        summary: 'Modificar una reserva PROGRAMADA',
        operationId: 'actualizarReserva',
        requestBody: {
          required: true,
          ...jsonSchema('#/components/schemas/ActualizarReservaRequest'),
        },
        responses: {
          '200': reservaResponse('Reserva actualizada.'),
          '400': errorResponse('Datos, fecha o identificador inválidos.'),
          '404': errorResponse('Reserva no encontrada.'),
          '409': errorResponse('Reserva no modificable.'),
          '500': errorResponse('Error de persistencia.'),
        },
      },
      delete: {
        tags: ['Reservas'],
        summary: 'Cancelar lógicamente una reserva PROGRAMADA',
        operationId: 'cancelarReserva',
        responses: {
          '200': reservaResponse('Reserva cancelada.'),
          '400': errorResponse('Identificador inválido.'),
          '404': errorResponse('Reserva no encontrada.'),
          '409': errorResponse('Reserva no cancelable.'),
          '500': errorResponse('Error de persistencia.'),
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
          service: { type: 'string', example: 'm9-reservas-programadas' },
          status: { type: 'string', enum: ['ok'] },
        },
      },
      CrearReservaRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['clienteId', 'origen', 'destino', 'vehiculo', 'fechaHoraProgramada'],
        properties: {
          clienteId: { type: 'string', format: 'uuid' },
          origen: { type: 'string', minLength: 1, maxLength: 500 },
          destino: { type: 'string', minLength: 1, maxLength: 500 },
          vehiculo: { type: 'string', enum: ['AUTO', 'MOTO'] },
          fechaHoraProgramada: { type: 'string', format: 'date-time' },
        },
      },
      ActualizarReservaRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          origen: { type: 'string', minLength: 1, maxLength: 500 },
          destino: { type: 'string', minLength: 1, maxLength: 500 },
          vehiculo: { type: 'string', enum: ['AUTO', 'MOTO'] },
          fechaHoraProgramada: { type: 'string', format: 'date-time' },
        },
      },
      Reserva: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id', 'clienteId', 'origen', 'destino', 'vehiculo', 'fechaHoraProgramada',
          'estado', 'tarifaEstimada', 'moneda', 'criterioAsignacion', 'idSolicitud',
          'creadoEn', 'actualizadoEn',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          clienteId: { type: 'string', format: 'uuid' },
          origen: { type: 'string' },
          destino: { type: 'string' },
          vehiculo: { type: 'string', enum: ['AUTO', 'MOTO'] },
          fechaHoraProgramada: { type: 'string', format: 'date-time' },
          estado: {
            type: 'string',
            enum: ['PROGRAMADA', 'ACTIVANDO', 'ACTIVADA', 'CANCELADA', 'FALLIDA'],
          },
          tarifaEstimada: { type: 'number', nullable: true },
          moneda: { type: 'string', nullable: true },
          criterioAsignacion: { type: 'string', nullable: true },
          idSolicitud: { type: 'string', format: 'uuid', nullable: true },
          creadoEn: { type: 'string', format: 'date-time', nullable: true },
          actualizadoEn: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ErrorResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            additionalProperties: false,
            required: ['codigo', 'mensaje'],
            properties: {
              codigo: { type: 'string' },
              mensaje: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;
