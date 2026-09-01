import { test as prueba } from 'node:test';
import verificar from 'node:assert/strict';

import { validarDireccion } from '../src/domain/validaciones.js';

prueba('Acepta una favorita, limpia espacios y asigna AMBOS', () => {
  const direccion = validarDireccion({
    alias: '  Casa  ',
    direccion: '  Av. 3 de Abril 1200  ',
    tipo: 'FAVORITA'
  });

  verificar.deepEqual(direccion, {
    alias: 'Casa',
    direccion: 'Av. 3 de Abril 1200',
    latitud: null,
    longitud: null,
    tipo: 'FAVORITA',
    uso: 'AMBOS'
  });
});

prueba('Acepta una reciente solo con coordenadas, incluyendo cero', () => {
  const direccion = validarDireccion({
    latitud: 0,
    longitud: 0,
    tipo: 'RECIENTE',
    uso: 'DESTINO'
  });

  verificar.deepEqual(direccion, {
    alias: null,
    direccion: null,
    latitud: 0,
    longitud: 0,
    tipo: 'RECIENTE',
    uso: 'DESTINO'
  });
});

const base = {
  direccion: 'Calle San Martín 100',
  tipo: 'FAVORITA'
};

const casosInvalidos: [string, unknown][] = [
  ['un cuerpo nulo', null],
  ['un arreglo', []],
  ['un texto como cuerpo', 'Casa'],

  [
    'una dirección sin texto ni coordenadas',
    { tipo: 'FAVORITA' }
  ],

  [
    'latitud sin longitud',
    { ...base, latitud: -27.47 }
  ],

  [
    'longitud sin latitud',
    { ...base, longitud: -58.83 }
  ],

  [
    'coordenadas como texto',
    { ...base, latitud: '-27', longitud: -58 }
  ],

  [
    'latitud fuera de rango',
    { ...base, latitud: 91, longitud: 0 }
  ],

  [
    'longitud fuera de rango',
    { ...base, latitud: 0, longitud: -181 }
  ],

  [
    'un tipo desconocido',
    { ...base, tipo: 'OTRA' }
  ],

  [
    'un uso desconocido',
    { ...base, uso: 'OTRO' }
  ],

  [
    'un alias vacío',
    { ...base, alias: '   ' }
  ],

  [
    'un alias que no es texto',
    { ...base, alias: 123 }
  ],

  [
    'un alias demasiado largo',
    { ...base, alias: 'a'.repeat(51) }
  ],

  [
    'una dirección demasiado larga',
    { ...base, direccion: 'a'.repeat(251) }
  ],

  [
    'campos no permitidos',
    { ...base, clienteId: 'cliente-2' }
  ]
];

for (const [descripcion, cuerpo] of casosInvalidos) {
  prueba(`Rechaza ${descripcion}`, () => {
    verificar.throws(
      () => validarDireccion(cuerpo),
      {
        name: 'ErrorAplicacion',
        estadoHttp: 400,
        codigo: 'DATOS_INVALIDOS'
      }
    );
  });
}