/**
 * OpenAPI 3.1 Specification for Module 2 (Customers)
 * Generated according to SPECM5 requirements
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Módulo 2 - Servicio de Clientes (API)',
    version: '1.0.0',
    description: 'API RESTful para la gestión del Perfil de Clientes, Preferencias, Historial de Viajes y Estado de Cuenta (AE1).'
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
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'phone'],
                properties: {
                  name: { type: 'string', example: 'Juan Pérez' },
                  email: { type: 'string', example: 'juan.perez@example.com' },
                  phone: { type: 'string', example: '+5493512345678' },
                  preferences: {
                    type: 'object',
                    properties: {
                      preferredVehicleType: { type: 'string', enum: ['auto', 'moto'], default: 'auto' },
                      notificationChannel: { type: 'string', enum: ['email', 'push'], default: 'email' }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          '201': { description: 'Cliente creado con éxito' },
          '400': { description: 'Datos de entrada inválidos' }
        }
      },
      get: {
        summary: 'Listar todos los clientes (Helper para UI)',
        responses: {
          '200': { description: 'Lista de clientes' }
        }
      }
    },
    '/v1/customers/{id}': {
      get: {
        summary: 'Obtener perfil de cliente por ID (RF-2.1)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'cust_823a7b9c' }
        ],
        responses: {
          '200': { description: 'Perfil encontrado' },
          '404': { description: 'Cliente no encontrado' }
        }
      },
      put: {
        summary: 'Actualizar preferencias del cliente (RF-2.1)',
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
                  preferences: {
                    type: 'object',
                    properties: {
                      preferredVehicleType: { type: 'string', enum: ['auto', 'moto'] },
                      notificationChannel: { type: 'string', enum: ['email', 'push'] }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Preferencias actualizadas' },
          '404': { description: 'Cliente no encontrado' }
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
    }
  }
};
