/**
 * OpenAPI 3.1 Specification for Module 2 (Customers)
 * Generated according to SPECM5 requirements
 */
// allow: SIZE_OK — declarative OpenAPI document; keeping one contract preserves Scalar's single source.
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Módulo 2 - Servicio de Clientes (API)',
    version: '1.0.0',
    description: 'API RESTful del perfil de clientes y sus preferencias (RF-2.1). La identidad, el nombre, el teléfono y el correo se validan en M1; M2 solo persiste userId y las preferencias del perfil.'
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Servidor Local de Desarrollo'
    }
  ],
  paths: {
    '/v1/customers': {
      post: {
        summary: 'Crear perfil de cliente (RF-2.1)',
        description: 'Requiere un JWT de M1 con rol CLIENTE. El userId se toma del token; el cuerpo solo contiene preferencias opcionales.',
        operationId: 'createCustomerProfile',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  preferences: { $ref: '#/components/schemas/PreferencesInput' }
                }
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Perfil creado con éxito',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerProfile' } } }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '409': { $ref: '#/components/responses/ProfileAlreadyExists' },
          '503': { $ref: '#/components/responses/ServiceUnavailable' }
        }
      },
      get: {
        summary: 'Listar todos los clientes (Helper para UI)',
        description: 'Listado público. Cuando se usa userId se devuelve el perfil asociado a ese identificador; los consumidores internos deben enviar el JWT de usuario.',
        operationId: 'listCustomers',
        parameters: [
          {
            name: 'userId',
            in: 'query',
            required: false,
            description: 'Identificador de usuario de M1 para filtrar el listado.',
            schema: { type: 'integer', format: 'int32', minimum: 1 },
            example: 12
          }
        ],
        responses: {
          '200': {
            description: 'Lista de perfiles',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/CustomerProfile' } }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/ServiceUnavailable' }
        }
      }
    },
    '/v1/customers/me': {
      get: {
        summary: 'Obtener mi perfil (RF-2.1)',
        description: 'Requiere un JWT de M1. Devuelve 404 si el userId autenticado todavía no tiene perfil.',
        operationId: 'getCurrentCustomerProfile',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Perfil autenticado',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerProfile' } } }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/ServiceUnavailable' }
        }
      }
    },
    '/v1/customers/{id}': {
      get: {
        summary: 'Obtener perfil de cliente por ID (RF-2.1)',
        description: 'Requiere un JWT de usuario. El identificador es el customerId interno cust_xxx.',
        operationId: 'getCustomerProfile',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': {
            description: 'Perfil encontrado',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomerProfile' } } }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '503': { $ref: '#/components/responses/ServiceUnavailable' }
        }
      },
      put: {
        summary: 'Actualizar preferencias del cliente (RF-2.1)',
        description: 'Requiere un JWT y solo permite al dueño del perfil actualizar sus preferencias. No acepta nombre, teléfono, correo ni direcciones.',
        operationId: 'updateCustomerPreferences',
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
                additionalProperties: false,
                required: ['preferences'],
                properties: {
                  preferences: { $ref: '#/components/schemas/PreferencesInput' }
                }
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Preferencias actualizadas',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['customerId', 'preferences', 'status'],
                  properties: {
                    customerId: { type: 'string', pattern: '^cust_[A-Za-z0-9]+$' },
                    preferences: { $ref: '#/components/schemas/Preferences' },
                    status: { $ref: '#/components/schemas/CustomerStatus' }
                  }
                }
              }
            }
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '503': { $ref: '#/components/responses/ServiceUnavailable' }
        }
      }
    },
    '/v1/customers/{id}/status': {
      get: {
        summary: 'Consultar estado operativo y de cuenta (RF-2.5)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': { description: 'Estado de cuenta del cliente' },
          '404': { description: 'Cliente no encontrado' }
        }
      },
      put: {
        summary: 'Cambiar estado de cuenta: baja (INACTIVO) o bloqueo (RF-2.5)',
        description: 'Los clientes nunca se eliminan. Para dar de baja a un cliente se cambia su estado a INACTIVO.',
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
                  status: {
                    type: 'string',
                    enum: ['ACTIVO', 'INACTIVO', 'BLOQUEADO_TEMPORAL', 'BLOQUEADO_PERMANENTE', 'EN_REVISIÓN'],
                    example: 'INACTIVO'
                  },
                  reason: { type: 'string', example: 'Baja solicitada por el cliente' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Estado de cuenta actualizado' },
          '400': { description: 'Estado o motivo inválido' },
          '404': { description: 'Cliente no encontrado' }
        }
      }
    },
    '/v1/customers/{id}/trips': {
      get: {
        summary: 'Consultar historial de viajes consumiendo síncronamente M6 (RF-2.3)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': { description: 'Historial consolidado de viajes del cliente' },
          '404': { description: 'Cliente no encontrado' }
        }
      }
    },
    '/health': {
      get: {
        summary: 'Estado de salud del módulo',
        description: 'Endpoint público para comprobar PostgreSQL, Redis y las dependencias registradas.',
        operationId: 'getHealth',
        security: [],
        responses: {
          '200': {
            description: 'Estado de salud disponible',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } }
          },
          '503': { $ref: '#/components/responses/ServiceUnavailable' }
        }
      }
    },
    '/metrics': {
      get: {
        summary: 'Métricas Prometheus',
        description: 'Endpoint público para métricas HTTP, caché y circuit breakers. La respuesta se sirve como text/plain en formato Prometheus.',
        operationId: 'getMetrics',
        security: [],
        responses: {
          '200': {
            description: 'Métricas Prometheus',
            content: { 'text/plain': { schema: { type: 'string' } } }
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT HS256 emitido y validado por M1. El token incluye userId, role, iat y exp.'
      }
    },
    schemas: {
      PreferencesInput: {
        type: 'object',
        additionalProperties: false,
        properties: {
          preferredVehicleType: { type: 'string', enum: ['auto', 'moto'], default: 'auto' },
          notificationChannel: { type: 'string', enum: ['email', 'push'], default: 'email' }
        }
      },
      Preferences: {
        type: 'object',
        additionalProperties: false,
        required: ['preferredVehicleType', 'notificationChannel'],
        properties: {
          preferredVehicleType: { type: 'string', enum: ['auto', 'moto'] },
          notificationChannel: { type: 'string', enum: ['email', 'push'] }
        }
      },
      CustomerStatus: {
        type: 'string',
        enum: ['ACTIVO', 'INACTIVO', 'BLOQUEADO_TEMPORAL', 'BLOQUEADO_PERMANENTE', 'EN_REVISIÓN']
      },
      CustomerProfile: {
        type: 'object',
        additionalProperties: false,
        required: ['customerId', 'userId', 'preferences', 'status', 'createdAt'],
        properties: {
          customerId: { type: 'string', pattern: '^cust_[A-Za-z0-9]+$', example: 'cust_823a7b9c' },
          userId: { type: 'integer', format: 'int32', minimum: 1, example: 12 },
          preferences: { $ref: '#/components/schemas/Preferences' },
          status: { $ref: '#/components/schemas/CustomerStatus' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['error', 'message'],
        properties: {
          error: { type: 'string', example: 'Unauthorized' },
          message: { type: 'string' },
          details: { type: 'array', items: { type: 'object', additionalProperties: true } },
          retryAfter: { type: 'integer', minimum: 1, description: 'Segundos sugeridos para reintentar.' }
        }
      },
      HealthResponse: {
        type: 'object',
        required: ['status', 'service'],
        properties: {
          status: { type: 'string', enum: ['UP', 'DEGRADED', 'DOWN'] },
          service: { type: 'string', example: 'm2-clientes-api' },
          checks: { type: 'object', additionalProperties: { type: 'string' } }
        }
      }
    },
    responses: {
      BadRequest: {
        description: 'Datos de entrada inválidos',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      Unauthorized: {
        description: 'Falta el bearer token o el token no es válido. Si M1 está caído, la respuesta es 503.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      Forbidden: {
        description: 'El rol no permite la operación o el perfil pertenece a otro usuario.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      ProfileAlreadyExists: {
        description: 'El userId autenticado ya tiene un perfil.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      NotFound: {
        description: 'No se encontró el perfil solicitado.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      ServiceUnavailable: {
        description: 'PostgreSQL, Redis o M1 no está disponible. El servidor incluye Retry-After.',
        headers: {
          'Retry-After': {
            description: 'Segundos que conviene esperar antes de reintentar.',
            schema: { type: 'integer', minimum: 1, example: 10 }
          }
        },
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      }
    }
  }
};
