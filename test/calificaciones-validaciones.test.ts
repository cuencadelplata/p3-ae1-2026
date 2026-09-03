import { test as prueba } from 'node:test';
import verificar from 'node:assert/strict';
import { validarCalificacion } from '../src/domain/calificaciones.js';
import { ErrorAplicacion } from '../src/domain/errores.js';

prueba('La calificación limpia espacios y conserva los datos válidos', () => {
  verificar.deepEqual(validarCalificacion({
    viajeId: ' viaje-1 ', puntuacion: 5, comentario: ' Buen viaje. '
  }), { viajeId: 'viaje-1', puntuacion: 5, comentario: 'Buen viaje.' });
});

prueba('La puntuación acepta los dos límites: 1 y 5', () => {
  for (const puntuacion of [1, 5]) {
    verificar.equal(validarCalificacion({ viajeId: 'viaje-1', puntuacion }).puntuacion, puntuacion);
  }
});

prueba('Un comentario omitido, null o vacío se convierte en null', () => {
  for (const comentario of [undefined, null, '', '   ']) {
    verificar.equal(validarCalificacion({
      viajeId: 'viaje-1', puntuacion: 4, comentario
    }).comentario, null);
  }
});

prueba('Un comentario de exactamente 500 caracteres es válido', () => {
  verificar.equal(validarCalificacion({
    viajeId: 'viaje-1', puntuacion: 4, comentario: 'a'.repeat(500)
  }).comentario?.length, 500);
});

const valido = { viajeId: 'viaje-1', puntuacion: 4 };
const invalidos: Array<[string, unknown]> = [
  ['cuerpo nulo', null],
  ['cuerpo que es un arreglo', []],
  ['cuerpo que es un texto', 'texto'],
  ['viaje omitido', { puntuacion: 4 }],
  ['viaje sin texto', { ...valido, viajeId: 123 }],
  ['viaje vacío', { ...valido, viajeId: '   ' }],
  ['viaje demasiado largo', { ...valido, viajeId: 'v'.repeat(101) }],
  ['puntuación omitida', { viajeId: 'viaje-1' }],
  ['puntuación cero', { ...valido, puntuacion: 0 }],
  ['puntuación mayor que cinco', { ...valido, puntuacion: 6 }],
  ['puntuación decimal', { ...valido, puntuacion: 2.5 }],
  ['puntuación como texto', { ...valido, puntuacion: '5' }],
  ['puntuación no finita', { ...valido, puntuacion: Infinity }],
  ['comentario de otro tipo', { ...valido, comentario: 123 }],
  ['comentario demasiado largo', { ...valido, comentario: 'a'.repeat(501) }],
  ['conductor impuesto por el cliente', { ...valido, conductorId: 'otro' }],
  ['estado impuesto por el cliente', { ...valido, estado: 'COMPLETADO' }]
];

for (const [nombre, cuerpo] of invalidos) {
  prueba(`Calificación: rechaza ${nombre}`, () => {
    verificar.throws(() => validarCalificacion(cuerpo), (error: unknown) => {
      verificar.ok(error instanceof ErrorAplicacion);
      verificar.equal(error.estadoHttp, 400);
      verificar.equal(error.codigo, 'DATOS_INVALIDOS');
      return true;
    });
  });
}