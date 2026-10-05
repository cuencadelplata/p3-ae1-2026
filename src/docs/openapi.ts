/**
 * OpenAPI 3.1 Specification for Module 2 (Customers)
 * Generated according to SPECM5 requirements
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Módulo 2 - Servicio de Clientes (API)',
    version: '1.0.0',
    description:
      'API RESTful para la gestión del Perfil de Clientes, Preferencias, ' +
      'Historial de Viajes (RF-2.3) y Estado de Cuenta (RF-2.5). ' +
      'Los endpoints marcados con 🔒 requieren el header `Authorization: Bearer <token>` ' +
      'emitido por M1 (Auth).'
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Servidor Local de Desarrollo'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT emitido por M1. Se valida contra GET /auth/validar-identidad-y-rol de M1.'
      }
    },
    schemas: {
      AccountStatusEnum: {
        type: 'string',
        enum: ['ACTIVO', 'INACTIVO', 'BLOQUEADO_TEMPORAL', 'BLOQUEADO_PERMANENTE', 'EN_REVISIÓN'],
        description:
          'Estado operativo del perfil. ' +
          'INACTIVO = baja voluntaria. ' +
          'BLOQUEADO_TEMPORAL / BLOQUEADO_PERMANENTE pueden ser automáticos (por penalizaciones de Soporte) o manuales.'
      },
      Preferences: {
        type: 'object',
        properties: {
          preferredVehicleType: {
            type: 'string',
            enum: ['auto', 'moto'],
            default: 'auto'
          },
          notificationChannel: {
            type: 'string',
            enum: ['email', 'push'],
            default: 'email'
          }
        }
      },
      CustomerProfile: {
        type: 'object',
        properties: {
          customerId:  { type: 'string', example: 'cust_823a7b9c' },
          name:        { type: 'string', example: 'Juan Pérez' },
          email:       { type: 'string', example: 'juan.perez@example.com' },
          phone:       { type: 'string', example: '+5493512345678' },
          preferences: { $ref: '#/components/schemas/Preferences' },
          status:      { $ref: '#/components/schemas/AccountStatusEnum' },
          createdAt:   { type: 'string', format: 'date-time' },
          updatedAt:   { type: 'string', format: 'date-time' }
        }
      },
      AccountStatusResponse: {
        type: 'object',
        properties: {
          customerId: { type: 'string', example: 'cust_823a7b9c' },
          status:     { $ref: '#/components/schemas/AccountStatusEnum' },
          reason:     { type: 'string', example: 'Bloqueado automáticamente por 2 penalización(es) vigente(s)' },
          blockOrigin: {
            type: 'string',
            enum: ['AUTOMATICO', 'MANUAL'],
            nullable: true,
            description:
              'Presente solo cuando hay un bloqueo activo. ' +
              'AUTOMATICO = generado por penalizaciones de Soporte (puede revertirse automáticamente). ' +
              'MANUAL = aplicado por el propio usuario o un admin.'
          },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      TripSummary: {
        type: 'object',
        properties: {
          tripId:      { type: 'string', example: 'trip_99217c2f' },
          origin:      { type: 'string', example: 'Av. Colón 1200, Córdoba' },
          destination: { type: 'string', example: 'Av. General Paz 250, Córdoba' },
          fare:        { type: 'number', example: 1850.0 },
          status:      { type: 'string', example: 'COMPLETADO' },
          createdAt:   { type: 'string', format: 'date-time' }
        }
      },
      CustomerTripsResponse: {
        type: 'object',
        properties: {
          customerId: { type: 'string', example: 'cust_823a7b9c' },
          tripsCount: { type: 'integer', example: 2 },
          trips: {
            type: 'array',
            items: { $ref: '#/components/schemas/TripSummary' }
          }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error:   { type: 'string', example: 'CustomerNotFound' },
          message: { type: 'string', example: 'No se encontró un cliente con el ID proporcionado' }
        }
      },
      ServiceUnavailableResponse: {
        type: 'object',
        properties: {
          error:      { type: 'string', example: 'ServiceUnavailable' },
          message:    { type: 'string' },
          retryAfter: { type: 'integer', example: 10, description: 'Segundos sugeridos antes de reintentar' }
        }
      }
    }
  },
  paths: {
    '/v1/customers': {
      post: {
        summary: '🔒 Crear perfil de cliente (RF-2.1)',
        description:
          'Registra un nuevo perfil. El body solo lleva preferencias opcionales: ' +
          'los datos de identidad (nombre, email) los tiene M1. ' +
          'Devuelve 409 si ya existe un perfil para ese userId.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  preferences: { $ref: '#/components/schemas/Preferences' }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Perfil creado',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CustomerProfile' }
              }
            }
          },
          '400': { description: 'Datos inválidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '401': { description: 'Sin token o token inválido', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'El rol del token no es CLIENTE', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'Ya existe un perfil para este usuario', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '503': { description: 'M1 o DB no disponibles (nunca devuelve 401 si M1 está caído)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServiceUnavailableResponse' } } } }
        }
      },
      get: {
        summary: 'Listar todos los clientes (abierto — helper para UI y M8)',
        description: 'Acepta ?userId= para que M8 pueda consultar el perfil por userId de M1.',
        parameters: [
          {
            name: 'userId',
            in: 'query',
            required: false,
            schema: { type: 'integer' },
            description: 'Filtrar por userId de M1'
          }
        ],
        responses: {
          '200': {
            description: 'Lista de clientes',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/CustomerProfile' } }
              }
            }
          },
          '503': { description: 'DB no disponible', content: { 'application/json': { schema: { $ref: '#/components/schemas/ServiceUnavailableResponse' } } } }
        }
      }
    },
    '/v1/customers/me': {
      get: {
        summary: '🔒 Obtener el perfil del usuario autenticado (RF-2.1)',
        description: 'Devuelve 404 si el usuario aún no creó su perfil (el front muestra el formulario de alta).',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Perfil del usuario', content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerProfile' } } } },
          '401': { description: 'Sin token o token inválido' },
          '404': { description: 'Perfil no existe todavía' },
          '503': { description: 'M1 o DB no disponibles' }
        }
      }
    },
    '/v1/customers/{id}': {
      get: {
        summary: '🔒 Obtener perfil de cliente por ID (RF-2.1)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': { description: 'Perfil encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerProfile' } } } },
          '401': { description: 'Sin token o token inválido' },
          '404': { description: 'Cliente no encontrado' },
          '503': { description: 'DB no disponible' }
        }
      },
      put: {
        summary: '🔒 Actualizar preferencias del cliente (RF-2.1, solo el dueño)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['preferences'],
                properties: {
                  preferences: { $ref: '#/components/schemas/Preferences' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Preferencias actualizadas' },
          '400': { description: 'Datos inválidos' },
          '401': { description: 'Sin token o token inválido' },
          '403': { description: 'El token no pertenece al dueño del perfil' },
          '404': { description: 'Cliente no encontrado' },
          '503': { description: 'DB no disponible' }
        }
      }
    },
    '/v1/customers/{id}/status': {
      get: {
        summary: '🔒 Consultar estado de cuenta — recalcula con penalizaciones de Soporte (RF-2.5)',
        description:
          'Consulta las penalizaciones vigentes de Soporte y recalcula el estado. ' +
          'Umbrales por defecto: 2+ penalizaciones → BLOQUEADO_TEMPORAL, 3+ → BLOQUEADO_PERMANENTE ' +
          '(configurables con PENALIZACIONES_TEMPORAL y PENALIZACIONES_PERMANENTE). ' +
          'Si Soporte está caído, devuelve el último estado guardado sin falla.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': {
            description: 'Estado de cuenta (puede haber sido recalculado)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AccountStatusResponse' }
              }
            }
          },
          '401': { description: 'Sin token o token inválido' },
          '404': { description: 'Cliente no encontrado' },
          '503': {
            description: 'DB no disponible (Soporte caído no genera 503: se usa el último estado guardado)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ServiceUnavailableResponse' } } }
          }
        }
      },
      put: {
        summary: '🔒 Cambiar estado de cuenta — solo el dueño (RF-2.5)',
        description:
          'Permite al usuario darse de baja (INACTIVO), solicitar revisión, etc. ' +
          'Los clientes nunca se eliminan: la baja es un cambio de estado. ' +
          'El bloqueo aplicado aquí se registra como MANUAL y no es revertido automáticamente ' +
          'por las penalizaciones (a diferencia de los bloqueos AUTOMATICOS de GET /status).',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status', 'reason'],
                properties: {
                  status: { $ref: '#/components/schemas/AccountStatusEnum' },
                  reason: { type: 'string', minLength: 3, example: 'Baja solicitada por el cliente' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Estado actualizado',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AccountStatusResponse' } } }
          },
          '400': { description: 'Estado o motivo inválido' },
          '401': { description: 'Sin token o token inválido' },
          '403': { description: 'El token no pertenece al dueño del perfil' },
          '404': { description: 'Cliente no encontrado' },
          '503': { description: 'DB no disponible' }
        }
      }
    },
    '/v1/customers/{id}/trips': {
      get: {
        summary: '🔒 Consultar historial de viajes — consume M6 síncronamente (RF-2.3)',
        description:
          'Consulta los viajes del usuario en M6 usando su userId de M1 y reenviando el token. ' +
          'Si M6 está caído devuelve una lista vacía con tripsCount=0 (respuesta degradada, no 503). ' +
          'El fallback evita bloquear al usuario cuando M6 no responde.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': {
            description: 'Historial de viajes (puede ser lista vacía si M6 está caído)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CustomerTripsResponse' }
              }
            }
          },
          '401': { description: 'Sin token o token inválido' },
          '404': { description: 'Cliente no encontrado' },
          '503': { description: 'DB no disponible (M6 caído no genera 503)' }
        }
      }
    }
  }
};
