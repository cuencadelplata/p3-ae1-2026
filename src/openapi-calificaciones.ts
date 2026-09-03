const referenciaCalificacion = { $ref: '#/components/schemas/Calificacion' };
const parametroCliente = { $ref: '#/components/parameters/Cliente' };

function respuestaJson(descripcion: string, esquema: object) {
  return { description: descripcion, content: { 'application/json': { schema: esquema } } };
}

function respuestaError(descripcion: string) {
  return respuestaJson(descripcion, { $ref: '#/components/schemas/Error' });
}

export const rutasCalificaciones = {
  '/clientes/{clienteId}/calificaciones': {
    parameters: [parametroCliente],
    post: {
      tags: ['Calificaciones'],
      summary: 'Calificar al conductor de un viaje completado',
      description:
        'AE1 usa ViajesSimulados: viaje-1 y viaje-5 completados; viaje-2 en curso; ' +
        'viaje-3 cancelado; viaje-4 de otro cliente. El servidor obtiene el conductor ' +
        'del viaje. Solo se admite una calificación por cliente y viaje.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/DatosCalificacion' },
            example: { viajeId: 'viaje-1', puntuacion: 5, comentario: 'Buen trato.' }
          }
        }
      },
      responses: {
        '201': {
          ...respuestaJson('Calificación guardada.', referenciaCalificacion),
          headers: { Location: { description: 'Ruta de consulta.', schema: { type: 'string' } } }
        },
        '400': respuestaError('Datos o JSON inválidos.'),
        '403': respuestaError('La ruta pertenece a otro cliente.'),
        '404': respuestaError('Viaje inexistente o de otro cliente.'),
        '409': respuestaError('El cliente ya calificó este viaje.'),
        '413': respuestaError('El cuerpo supera los 16 KB.'),
        '422': respuestaError('El viaje no está completado.'),
        '503': respuestaError('No se pudo verificar el viaje.'),
        '500': respuestaError('Error interno.')
      }
    },
    get: {
      tags: ['Calificaciones'],
      summary: 'Listar las calificaciones emitidas por el cliente',
      responses: {
        '200': respuestaJson('De más nuevas a más antiguas.', {
          type: 'array', items: referenciaCalificacion
        }),
        '403': respuestaError('La ruta pertenece a otro cliente.'),
        '500': respuestaError('Error interno.')
      }
    }
  },
  '/clientes/{clienteId}/calificaciones/{id}': {
    parameters: [parametroCliente, { $ref: '#/components/parameters/Identificador' }],
    get: {
      tags: ['Calificaciones'],
      summary: 'Consultar una calificación propia',
      responses: {
        '200': respuestaJson('Calificación encontrada.', referenciaCalificacion),
        '403': respuestaError('La ruta pertenece a otro cliente.'),
        '404': respuestaError('Calificación inexistente o de otro cliente.'),
        '500': respuestaError('Error interno.')
      }
    }
  }
};

export const esquemasCalificaciones = {
  DatosCalificacion: {
    type: 'object',
    additionalProperties: false,
    required: ['viajeId', 'puntuacion'],
    description:
      'Los textos se recortan antes de validarse. Un comentario omitido, null o ' +
      'vacío se guarda como null. No enviar clienteId, conductorId ni estado.',
    properties: {
      viajeId: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
      puntuacion: { type: 'integer', minimum: 1, maximum: 5 },
      comentario: { type: 'string', nullable: true, maxLength: 500 }
    }
  },
  Calificacion: {
    type: 'object',
    required: ['id', 'clienteId', 'viajeId', 'conductorId', 'puntuacion', 'comentario', 'fechaCreacion'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      clienteId: { type: 'string' },
      viajeId: { type: 'string' },
      conductorId: { type: 'string' },
      puntuacion: { type: 'integer', minimum: 1, maximum: 5 },
      comentario: { type: 'string', nullable: true, maxLength: 500 },
      fechaCreacion: { type: 'string', format: 'date-time' }
    }
  }
};