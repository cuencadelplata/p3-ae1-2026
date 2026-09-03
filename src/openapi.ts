import { rutasCalificaciones, esquemasCalificaciones } from './openapi-calificaciones.js';

function respuestaJson(descripcion: string, esquema: object) {
  return {
    description: descripcion,
    content: {
      'application/json': {
        schema: esquema
      }
    }
  };
}

const referenciaDireccion = {
  $ref: '#/components/schemas/Direccion'
};

const referenciaError = {
  $ref: '#/components/schemas/Error'
};

const errores = {
  '400': respuestaJson(
    'Datos, filtro o JSON inválidos.',
    referenciaError
  ),
  '403': respuestaJson(
    'El cliente no coincide con la identidad simulada.',
    referenciaError
  ),
  '404': respuestaJson(
    'Dirección no encontrada para este cliente.',
    referenciaError
  ),
  '413': respuestaJson(
    'El cuerpo supera los 16 KB.',
    referenciaError
  ),
  '500': respuestaJson(
    'Error interno.',
    referenciaError
  )
};

const cuerpoDireccion = {
  required: true,
  content: {
    'application/json': {
      schema: {
        $ref: '#/components/schemas/DatosDireccion'
      },
      example: {
        alias: 'Casa',
        direccion: 'Av. 3 de Abril 1200',
        tipo: 'FAVORITA',
        uso: 'ORIGEN'
      }
    }
  }
};

const parametroCliente = {
  $ref: '#/components/parameters/Cliente'
};

const parametroDireccion = {
  $ref: '#/components/parameters/Identificador'
};

export const documentoOpenApi = {
  openapi: '3.0.3',

  info: {
    title: 'Módulo 2 — Clientes',
    version: '1.0.0',
    description:
      'AE1 · RF-2.2 y RF-2.4. Identidad y viajes simulados para esta entrega. ' +
      'Identidad simulada configurada en el servidor ' +
      '(cliente-1 por defecto). No implementa autenticación real. ' +
      'PUT reemplaza los datos editables: los opcionales omitidos ' +
      'vuelven a sus valores por defecto.'
  },

  servers: [
    { url: '/' }
  ],

  paths: {
    ...rutasCalificaciones,
    '/salud': {
      get: {
        summary: 'Comprobar disponibilidad',
        responses: {
          '200': respuestaJson('Disponible.', {
            $ref: '#/components/schemas/Salud'
          }),
          '503': respuestaJson('No disponible.', {
            $ref: '#/components/schemas/Salud'
          }),
          '500': errores['500']
        }
      }
    },

    '/sesion': {
      get: {
        summary: 'Consultar la identidad simulada de AE1',
        responses: {
          '200': respuestaJson(
            'Esta respuesta no autentica al usuario.',
            {
              type: 'object',
              required: ['clienteId', 'simulada'],
              properties: {
                clienteId: { type: 'string' },
                simulada: {
                  type: 'boolean',
                  enum: [true]
                }
              }
            }
          )
        }
      }
    },

    '/clientes/{clienteId}/direcciones': {
      parameters: [parametroCliente],

      get: {
        summary: 'Listar direcciones del cliente',
        parameters: [
          {
            name: 'tipo',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['FAVORITA', 'RECIENTE']
            }
          }
        ],
        responses: {
          '200': respuestaJson(
            'Direcciones, de más nuevas a más antiguas.',
            {
              type: 'array',
              items: referenciaDireccion
            }
          ),
          '400': errores['400'],
          '403': errores['403'],
          '500': errores['500']
        }
      },

      post: {
        summary: 'Guardar una dirección favorita o reciente',
        requestBody: cuerpoDireccion,
        responses: {
          '201': {
            ...respuestaJson(
              'Dirección creada.',
              referenciaDireccion
            ),
            headers: {
              Location: {
                description: 'Ruta de la nueva dirección.',
                schema: { type: 'string' }
              }
            }
          },
          '400': errores['400'],
          '403': errores['403'],
          '413': errores['413'],
          '500': errores['500']
        }
      }
    },

    '/clientes/{clienteId}/direcciones/{id}': {
      parameters: [
        parametroCliente,
        parametroDireccion
      ],

      get: {
        summary: 'Consultar una dirección',
        responses: {
          '200': respuestaJson(
            'Dirección encontrada.',
            referenciaDireccion
          ),
          '403': errores['403'],
          '404': errores['404'],
          '500': errores['500']
        }
      },

      put: {
        summary: 'Reemplazar los datos editables de una dirección',
        requestBody: cuerpoDireccion,
        responses: {
          '200': respuestaJson(
            'Dirección actualizada.',
            referenciaDireccion
          ),
          ...errores
        }
      },

      delete: {
        summary: 'Eliminar una dirección',
        responses: {
          '204': {
            description: 'Eliminada. La respuesta no tiene cuerpo.'
          },
          '403': errores['403'],
          '404': errores['404'],
          '500': errores['500']
        }
      }
    }
  },

  components: {
    parameters: {
      Cliente: {
        name: 'clienteId',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          default: 'cliente-1'
        }
      },

      Identificador: {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string'
        }
      }
    },

    schemas: {
      ...esquemasCalificaciones,
      DatosDireccion: {
        type: 'object',
        additionalProperties: false,
        required: ['tipo'],
        description:
          'Enviar dirección escrita o ambas coordenadas. ' +
          'Latitud y longitud siempre se envían juntas. ' +
          'Omitir los campos opcionales vacíos; no enviar null. ' +
          'Los textos se recortan antes de validar su longitud.',

        properties: {
          alias: {
            type: 'string',
            minLength: 1,
            maxLength: 50,
            pattern: '\\S'
          },
          direccion: {
            type: 'string',
            minLength: 1,
            maxLength: 250,
            pattern: '\\S'
          },
          latitud: {
            type: 'number',
            minimum: -90,
            maximum: 90
          },
          longitud: {
            type: 'number',
            minimum: -180,
            maximum: 180
          },
          tipo: {
            type: 'string',
            enum: ['FAVORITA', 'RECIENTE']
          },
          uso: {
            type: 'string',
            enum: ['ORIGEN', 'DESTINO', 'AMBOS'],
            default: 'AMBOS'
          }
        },

        allOf: [
          {
            anyOf: [
              { required: ['direccion'] },
              { required: ['latitud', 'longitud'] }
            ]
          },
          {
            anyOf: [
              { required: ['latitud', 'longitud'] },
              {
                not: {
                  anyOf: [
                    { required: ['latitud'] },
                    { required: ['longitud'] }
                  ]
                }
              }
            ]
          }
        ]
      },

      Direccion: {
        type: 'object',
        required: [
          'id',
          'clienteId',
          'alias',
          'direccion',
          'latitud',
          'longitud',
          'tipo',
          'uso',
          'fechaCreacion',
          'fechaActualizacion'
        ],
        properties: {
          id: {
            type: 'string',
            format: 'uuid'
          },
          clienteId: {
            type: 'string'
          },
          alias: {
            type: 'string',
            nullable: true
          },
          direccion: {
            type: 'string',
            nullable: true
          },
          latitud: {
            type: 'number',
            nullable: true
          },
          longitud: {
            type: 'number',
            nullable: true
          },
          tipo: {
            type: 'string',
            enum: ['FAVORITA', 'RECIENTE']
          },
          uso: {
            type: 'string',
            enum: ['ORIGEN', 'DESTINO', 'AMBOS']
          },
          fechaCreacion: {
            type: 'string',
            format: 'date-time'
          },
          fechaActualizacion: {
            type: 'string',
            format: 'date-time'
          }
        }
      },

      Error: {
        type: 'object',
        required: ['codigo', 'mensaje'],
        properties: {
          codigo: { type: 'string' },
          mensaje: { type: 'string' }
        }
      },

      Salud: {
        type: 'object',
        required: ['estado'],
        properties: {
          estado: {
            type: 'string',
            enum: ['OK', 'NO_DISPONIBLE']
          }
        }
      }
    }
  }
};