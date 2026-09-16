const examples = {
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
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: null,
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
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: null,
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
      criterioAsignacion: 'MEJOR_CALIFICACION',
      idSolicitud: null,
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
          criterioAsignacion: 'MEJOR_CALIFICACION',
          idSolicitud: null,
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
        mensaje: 'Solo se pueden modificar reservas en estado PROGRAMADA.',
      },
    },
  },
  ErrorNoCancelable: {
    summary: 'Reserva que no puede cancelarse',
    value: {
      error: {
        codigo: 'RESERVA_NO_CANCELABLE',
        mensaje: 'Solo se pueden cancelar reservas en estado PROGRAMADA.',
      },
    },
  },
  ErrorInterno: {
    summary: 'Error no controlado',
    value: { error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error interno.' } },
  },
} as const;

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
    version: '1.0.0',
    description:
      'API REST para administrar y activar reservas programadas. En AE1 M9 no implementa autenticación propia: la autenticación pertenece a M1 – Identidad y Acceso y su integración queda fuera del alcance actual del módulo.',
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
        operationId: 'crearReserva',
        requestBody: {
          required: true,
          ...jsonSchema('#/components/schemas/CrearReservaRequest', 'CrearReservaValida'),
        },
        responses: {
          '201': reservaResponse('Reserva creada.', 'ReservaProgramada'),
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
        summary: 'Cancelar lógicamente una reserva PROGRAMADA',
        operationId: 'cancelarReserva',
        responses: {
          '200': reservaResponse('Reserva cancelada.', 'ReservaCancelada'),
          '400': errorResponse('Identificador inválido.', 'ErrorValidacion'),
          '404': errorResponse('Reserva no encontrada.', 'ErrorNoEncontrada'),
          '409': errorResponse('Reserva no cancelable.', 'ErrorNoCancelable'),
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
          'criterioAsignacion',
          'idSolicitud',
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
