import express from 'express';
import type { ErrorRequestHandler } from 'express';

import { ServicioClientes } from './application/clientes-service.js';
import type { RepositorioClientes } from './application/ports.js';
import { ServicioCalificaciones } from './application/calificaciones-service.js';
import type { ConsultaViajes, RepositorioCalificaciones } from './application/calificaciones-ports.js';
import { ViajesSimulados } from './infrastructure/viajes-simulados.js';

import swaggerUi from 'swagger-ui-express';
import { documentoOpenApi } from './openapi.js';

import {
  ErrorAplicacion,
  recursoNoEncontrado
} from './domain/errores.js';

export function crearAplicacion(
  repositorio: RepositorioClientes & RepositorioCalificaciones,
  clienteSimulado = 'cliente-1',
  consultaViajes: ConsultaViajes = new ViajesSimulados(clienteSimulado)
) {
  const aplicacion = express();
  const servicio = new ServicioClientes(repositorio);
  const calificaciones = new ServicioCalificaciones(repositorio, consultaViajes);

  aplicacion.use(express.json({ limit: '16kb' }));

  aplicacion.get('/openapi.json', (_solicitud, respuesta) => {
    respuesta.json(documentoOpenApi);
  });

  aplicacion.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(documentoOpenApi, {
      swaggerOptions: {
        validatorUrl: null
      }
    })
  );

  aplicacion.get('/sesion', (_solicitud, respuesta) => {
    respuesta.json({
      clienteId: clienteSimulado,
      simulada: true
    });
  });

  aplicacion.get('/salud', (_solicitud, respuesta) => {
    const disponible = repositorio.estaDisponible();

    respuesta.status(disponible ? 200 : 503).json({
      estado: disponible ? 'OK' : 'NO_DISPONIBLE'
    });
  });

  // Identidad simulada.
  aplicacion.use(
    '/clientes/:clienteId',
    (solicitud, _respuesta, siguiente) => {
      if (solicitud.params.clienteId !== clienteSimulado) {
        throw new ErrorAplicacion(
          403,
          'ACCESO_DENEGADO',
          'Solo podés administrar tus propios datos.'
        );
      }

      siguiente();
    }
  );

  // Crear una dirección.
  aplicacion.post(
    '/clientes/:clienteId/direcciones',
    (solicitud, respuesta) => {
      const { clienteId } = solicitud.params;

      const direccion = servicio.crearDireccion(
        clienteId,
        solicitud.body
      );

      respuesta
        .location(
          `/clientes/${encodeURIComponent(clienteId)}/direcciones/${direccion.id}`
        )
        .status(201)
        .json(direccion);
    }
  );

  // Listar direcciones, con filtro.
  aplicacion.get(
    '/clientes/:clienteId/direcciones',
    (solicitud, respuesta) => {
      const direcciones = servicio.listarDirecciones(
        solicitud.params.clienteId,
        solicitud.query.tipo
      );

      respuesta.json(direcciones);
    }
  );

  // Obtener una dirección por su identificador.
  aplicacion.get(
    '/clientes/:clienteId/direcciones/:id',
    (solicitud, respuesta) => {
      const direccion = servicio.obtenerDireccion(
        solicitud.params.clienteId,
        solicitud.params.id
      );

      respuesta.json(direccion);
    }
  );

  // Actualizar una dirección.
  aplicacion.put(
    '/clientes/:clienteId/direcciones/:id',
    (solicitud, respuesta) => {
      const direccion = servicio.actualizarDireccion(
        solicitud.params.clienteId,
        solicitud.params.id,
        solicitud.body
      );

      respuesta.json(direccion);
    }
  );

  // Eliminar una dirección.
  aplicacion.delete(
    '/clientes/:clienteId/direcciones/:id',
    (solicitud, respuesta) => {
      servicio.eliminarDireccion(
        solicitud.params.clienteId,
        solicitud.params.id
      );

      respuesta.status(204).send();
    }
  );

  aplicacion.post('/clientes/:clienteId/calificaciones', async (solicitud, respuesta) => {
    const { clienteId } = solicitud.params;
    const calificacion = await calificaciones.crearCalificacion(clienteId, solicitud.body);
    respuesta
      .location(`/clientes/${encodeURIComponent(clienteId)}/calificaciones/${calificacion.id}`)
      .status(201)
      .json(calificacion);
  });

  aplicacion.get('/clientes/:clienteId/calificaciones', (solicitud, respuesta) => {
    respuesta.json(calificaciones.listarCalificaciones(solicitud.params.clienteId));
  });

  aplicacion.get('/clientes/:clienteId/calificaciones/:id', (solicitud, respuesta) => {
    respuesta.json(calificaciones.obtenerCalificacion(
      solicitud.params.clienteId, solicitud.params.id
    ));
  });

  // Responder cuando la ruta solicitada no existe.
  aplicacion.use((_solicitud, _respuesta) => {
    throw recursoNoEncontrado('Ruta no encontrada.');
  });

  // Convertir los errores en respuestas JSON.
  const manejarErrores: ErrorRequestHandler = (
    error: unknown,
    _solicitud,
    respuesta,
    siguiente
  ) => {
    if (respuesta.headersSent) {
      siguiente(error);
      return;
    }

    if (error instanceof ErrorAplicacion) {
      respuesta.status(error.estadoHttp).json({
        codigo: error.codigo,
        mensaje: error.message
      });

      return;
    }

    if (
      error !== null &&
      typeof error === 'object' &&
      'type' in error
    ) {
      if (error.type === 'entity.parse.failed') {
        respuesta.status(400).json({
          codigo: 'JSON_INVALIDO',
          mensaje: 'El cuerpo de la solicitud no contiene un JSON válido.'
        });

        return;
      }

      if (error.type === 'entity.too.large') {
        respuesta.status(413).json({
          codigo: 'CUERPO_DEMASIADO_GRANDE',
          mensaje: 'La solicitud supera el tamaño permitido.'
        });

        return;
      }
    }

    console.error(error);

    respuesta.status(500).json({
      codigo: 'ERROR_INTERNO',
      mensaje: 'Ocurrió un error interno.'
    });
  };

  aplicacion.use(manejarErrores);

  return aplicacion;
}