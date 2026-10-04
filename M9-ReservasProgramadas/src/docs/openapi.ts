const routeSnapshotEjemplo = {
  origin: { latitude: -27.4514, longitude: -58.9867, address: 'Terminal de Ómnibus' },
  destination: { latitude: -27.4692, longitude: -58.8306, address: 'Aeropuerto' },
  distanceKm: 18.4,
  estimatedDurationMin: 28,
};

const examplesBase = {
  HealthOk: {
    summary: 'Servicio disponible',
    value: { service: 'm9-reservas-programadas', status: 'ok' },
  },
  CrearReservaValida: {
    summary: 'Solicitud válida de reserva futura',
    value: {
      clienteId: '20000000-0000-4000-8000-000000000001',
      origen: 'Terminal de Ómnibus',
      destino: 'Aeropuerto',
      vehiculo: 'AUTO',
      fechaHoraProgramada: '2099-01-01T14:30:00-03:00',
    },
  },
  ActualizarReservaValida: {
    summary: 'Cambio de destino de una reserva programada',
    value: { destino: 'Puerto de Buenos Aires' },
  },
  ReservaProgramada: {
    summary: 'Reserva creada o consultada',
    value: {
      id: '10000000-0000-4000-8000-000000000001',
      clienteId: '20000000-0000-4000-8000-000000000001',
      origen: 'Terminal de Ómnibus',
      destino: 'Aeropuerto',
      vehiculo: 'AUTO',
      fechaHoraProgramada: '2099-01-01T17:30:00.000Z',
      estado: 'PROGRAMADA',
      tarifaEstimada: 2500,
      moneda: 'ARS',
      estimacionTarifaId: 'est_1234567890',
      routeSnapshot: routeSnapshotEjemplo,
      criterioAsignacion: null,
      idSolicitud: null,
      assignedDriverId: null,
      creadoEn: '2099-01-01T14:00:00.000Z',
      actualizadoEn: '2099-01-01T14:00:00.000Z',
    },
  },
  ReservaModificada: {
    summary: 'Reserva modificada correctamente',
    value: {
      id: '10000000-0000-4000-8000-000000000001',
      clienteId: '20000000-0000-4000-8000-000000000001',
      origen: 'Terminal de Ómnibus',
      destino: 'Puerto de Buenos Aires',
      vehiculo: 'AUTO',
      fechaHoraProgramada: '2099-01-01T17:30:00.000Z',
      estado: 'PROGRAMADA',
      tarifaEstimada: 2500,
      moneda: 'ARS',
      estimacionTarifaId: 'est_1234567891',
      routeSnapshot: {
        ...routeSnapshotEjemplo,
        destination: { ...routeSnapshotEjemplo.destination, address: 'Puerto de Buenos Aires' },
      },
      criterioAsignacion: null,
      idSolicitud: null,
      assignedDriverId: null,
      creadoEn: '2099-01-01T14:00:00.000Z',
      actualizadoEn: '2099-01-01T14:05:00.000Z',
    },
  },
  ReservaCancelada: {
    summary: 'Reserva cancelada lógicamente',
    value: {
      id: '10000000-0000-4000-8000-000000000001',
      clienteId: '20000000-0000-4000-8000-000000000001',
      origen: 'Terminal de Ómnibus',
      destino: 'Aeropuerto',
      vehiculo: 'AUTO',
      fechaHoraProgramada: '2099-01-01T17:30:00.000Z',
      estado: 'CANCELADA',
      tarifaEstimada: 2500,
      moneda: 'ARS',
      estimacionTarifaId: 'est_1234567890',
      routeSnapshot: routeSnapshotEjemplo,
      criterioAsignacion: null,
      idSolicitud: null,
      assignedDriverId: null,
      creadoEn: '2099-01-01T14:00:00.000Z',
      actualizadoEn: '2099-01-01T14:10:00.000Z',
    },
  },
  ListadoReservas: {
    summary: 'Lista ordenada por fecha programada',
    value: {
      reservas: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          clienteId: '20000000-0000-4000-8000-000000000001',
          origen: 'Terminal de Ómnibus',
          destino: 'Aeropuerto',
          vehiculo: 'AUTO',
          fechaHoraProgramada: '2099-01-01T17:30:00.000Z',
          estado: 'PROGRAMADA',
          tarifaEstimada: 2500,
          moneda: 'ARS',
          estimacionTarifaId: 'est_1234567890',
          routeSnapshot: routeSnapshotEjemplo,
          criterioAsignacion: null,
          idSolicitud: null,
          assignedDriverId: null,
          creadoEn: '2099-01-01T14:00:00.000Z',
          actualizadoEn: '2099-01-01T14:00:00.000Z',
        },
      ],
    },
  },
  ErrorValidacion: {
    summary: 'Fecha inválida',
    value: {
      error: {
        codigo: 'FECHA_INVALIDA',
        mensaje: 'La fecha y hora programada debe ser válida y futura.',
      },
    },
  },
  ErrorNoEncontrada: {
    summary: 'Reserva inexistente',
    value: { error: { codigo: 'RESERVA_NO_ENCONTRADA', mensaje: 'La reserva no existe.' } },
  },
  ErrorNoModificable: {
    summary: 'Reserva cancelada que no puede modificarse',
    value: {
      error: {
        codigo: 'RESERVA_NO_MODIFICABLE',
        mensaje: 'Solo se pueden modificar reservas PROGRAMADA.',
      },
    },
  },
  ErrorNoCancelable: {
    summary: 'Reserva que no puede cancelarse',
    value: {
      error: {
        codigo: 'RESERVA_NO_CANCELABLE',
        mensaje: 'Solo se pueden cancelar reservas PROGRAMADA o ACTIVANDO.',
      },
    },
  },
  ErrorInterno: {
    summary: 'Error no controlado',
    value: { error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error interno.' } },
  },
} as const;

const examples = examplesBase;

type ExampleName = keyof typeof examples;

const jsonSchema = (ref: string, exampleName?: ExampleName) => ({
  content: {
    'application/json': {
      schema: { $ref: ref },
      ...(exampleName === undefined
        ? {}
        : { examples: { principal: { $ref: `#/components/examples/${exampleName}` } } }),
    },
  },
});

const errorResponse = (description: string, exampleName: ExampleName) => ({
  description,
  ...jsonSchema('#/components/schemas/ErrorResponse', exampleName),
});

const reservaResponse = (description: string, exampleName: ExampleName) => ({
  description,
  ...jsonSchema('#/components/schemas/Reserva', exampleName),
});

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'M9 – Reservas Programadas',
    version: '2.0.0',
    description:
      'API REST para administrar reservas programadas. M9 estima tarifas con M7 al crear o modificar y solicita el despacho a M5 únicamente al llegar el horario programado. M9 no implementa autenticación propia; el token de servicio para M5 depende del contrato pendiente con M1.',
    license: {
      name: 'Uso académico',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Ejecución local predeterminada',
    },
  ],
  security: [],
  tags: [
    { name: 'Salud', description: 'Verificación de disponibilidad del servicio.' },
    { name: 'Documentación', description: 'Contrato OpenAPI del módulo.' },
    { name: 'Reservas', description: 'Gestión del ciclo de reservas programadas.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Salud'],
        summary: 'Consultar el estado básico del servicio',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'El servicio está disponible.',
            ...jsonSchema('#/components/schemas/HealthResponse', 'HealthOk'),
          },
        },
      },
    },
    '/readiness': {
      get: {
        tags: ['Salud'],
        summary: 'Comprobar dependencias críticas del proceso',
        operationId: 'getReadiness',
        responses: {
          '200': {
            description: 'PostgreSQL, Redis y RabbitMQ están disponibles.',
            ...jsonSchema('#/components/schemas/ReadinessResponse'),
          },
          '503': {
            description: 'El proceso está vivo, pero alguna dependencia está degradada.',
            ...jsonSchema('#/components/schemas/ReadinessResponse'),
          },
        },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['Documentación'],
        summary: 'Obtener la especificación OpenAPI',
        operationId: 'getOpenApiDocument',
        responses: {
          '200': {
            description: 'Especificación OpenAPI utilizada por Swagger UI.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    '/reservas': {
      post: {
        tags: ['Reservas'],
        summary: 'Crear una reserva programada',
        description:
          'Resuelve el recorrido, consulta la estimación de tarifa a M7 y guarda la reserva en PROGRAMADA. No invoca M5 ni asigna conductor durante la creación.',
        operationId: 'crearReserva',
        requestBody: {
          required: true,
          ...jsonSchema('#/components/schemas/CrearReservaRequest', 'CrearReservaValida'),
        },
        responses: {
          '201': {
            ...reservaResponse('Reserva guardada en estado PROGRAMADA.', 'ReservaProgramada'),
          },
          '400': errorResponse('Datos o fecha inválidos.', 'ErrorValidacion'),
          '500': errorResponse('Error de persistencia.', 'ErrorInterno'),
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
                examples: { principal: { $ref: '#/components/examples/ListadoReservas' } },
              },
            },
          },
          '500': errorResponse('Error de persistencia.', 'ErrorInterno'),
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
          example: '10000000-0000-4000-8000-000000000001',
        },
      ],
      get: {
        tags: ['Reservas'],
        summary: 'Obtener una reserva',
        operationId: 'obtenerReserva',
        responses: {
          '200': reservaResponse('Reserva encontrada.', 'ReservaProgramada'),
          '400': errorResponse('Identificador inválido.', 'ErrorValidacion'),
          '404': errorResponse('Reserva no encontrada.', 'ErrorNoEncontrada'),
          '500': errorResponse('Error de persistencia.', 'ErrorInterno'),
        },
      },
      patch: {
        tags: ['Reservas'],
        summary: 'Modificar una reserva PROGRAMADA',
        description:
          'Solo permite modificar una reserva PROGRAMADA. Recalcula RouteSnapshot y tarifa M7 cuando cambia origen o destino; si cambia el vehículo reutiliza la ruta y recalcula la tarifa. Cambiar solo fecha/hora no invoca M7.',
        operationId: 'actualizarReserva',
        requestBody: {
          required: true,
          ...jsonSchema('#/components/schemas/ActualizarReservaRequest', 'ActualizarReservaValida'),
        },
        responses: {
          '200': reservaResponse('Reserva actualizada.', 'ReservaModificada'),
          '400': errorResponse('Datos, fecha o identificador inválidos.', 'ErrorValidacion'),
          '404': errorResponse('Reserva no encontrada.', 'ErrorNoEncontrada'),
          '409': errorResponse('Reserva no modificable.', 'ErrorNoModificable'),
          '500': errorResponse('Error de persistencia.', 'ErrorInterno'),
        },
      },
      delete: {
        tags: ['Reservas'],
        summary: 'Cancelar una reserva PROGRAMADA o ACTIVANDO',
        description:
          'Cancela localmente una reserva PROGRAMADA. Si está ACTIVANDO sin idSolicitud responde 409 para no competir con el despacho asíncrono; si ya posee idSolicitud, solicita primero la cancelación a M5 y no oculta sus conflictos.',
        operationId: 'cancelarReserva',
        responses: {
          '200': reservaResponse('Reserva cancelada.', 'ReservaCancelada'),
          '400': errorResponse('Identificador inválido.', 'ErrorValidacion'),
          '404': errorResponse('Reserva no encontrada.', 'ErrorNoEncontrada'),
          '409': errorResponse('Reserva no cancelable.', 'ErrorNoCancelable'),
          '503': errorResponse(
            'M5 no está disponible para confirmar la cancelación.',
            'ErrorInterno',
          ),
          '500': errorResponse('Error de persistencia.', 'ErrorInterno'),
        },
      },
    },
  },
  components: {
    examples,
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
      ReadinessResponse: {
        type: 'object',
        required: ['status', 'dependencies'],
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ready', 'degraded'] },
          dependencies: {
            type: 'object',
            additionalProperties: { type: 'string', enum: ['up', 'down'] },
            example: { postgres: 'up', redis: 'up', rabbitmq: 'up' },
          },
        },
      },
      CrearReservaRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['clienteId', 'origen', 'destino', 'vehiculo', 'fechaHoraProgramada'],
        properties: {
          clienteId: { type: 'string', format: 'uuid' },
          origen: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'Debe ser diferente de destino.',
          },
          destino: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'Debe ser diferente de origen.',
          },
          vehiculo: { type: 'string', enum: ['AUTO', 'MOTO'] },
          fechaHoraProgramada: {
            type: 'string',
            format: 'date-time',
            description: 'Fecha ISO 8601 con offset y posterior al instante actual.',
          },
        },
      },
      ActualizarReservaRequest: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          origen: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'Debe ser diferente de destino.',
          },
          destino: {
            type: 'string',
            minLength: 1,
            maxLength: 500,
            description: 'Debe ser diferente de origen.',
          },
          vehiculo: { type: 'string', enum: ['AUTO', 'MOTO'] },
          fechaHoraProgramada: {
            type: 'string',
            format: 'date-time',
            description: 'Fecha ISO 8601 con offset y posterior al instante actual.',
          },
        },
      },
      Reserva: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'clienteId',
          'origen',
          'destino',
          'vehiculo',
          'fechaHoraProgramada',
          'estado',
          'tarifaEstimada',
          'moneda',
          'estimacionTarifaId',
          'routeSnapshot',
          'criterioAsignacion',
          'idSolicitud',
          'assignedDriverId',
          'creadoEn',
          'actualizadoEn',
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
          estimacionTarifaId: { type: 'string', nullable: true },
          routeSnapshot: {
            allOf: [{ $ref: '#/components/schemas/RouteSnapshot' }],
            nullable: true,
          },
          criterioAsignacion: { type: 'string', nullable: true },
          idSolicitud: { type: 'string', format: 'uuid', nullable: true },
          assignedDriverId: { type: 'string', nullable: true },
          creadoEn: { type: 'string', format: 'date-time', nullable: true },
          actualizadoEn: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      RouteSnapshot: {
        type: 'object',
        additionalProperties: false,
        required: ['origin', 'destination', 'distanceKm', 'estimatedDurationMin'],
        properties: {
          origin: { $ref: '#/components/schemas/GeoLocation' },
          destination: { $ref: '#/components/schemas/GeoLocation' },
          distanceKm: { type: 'number', minimum: 0 },
          estimatedDurationMin: { type: 'number', minimum: 0 },
        },
      },
      GeoLocation: {
        type: 'object',
        additionalProperties: false,
        required: ['latitude', 'longitude', 'address'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          address: { type: 'string' },
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
