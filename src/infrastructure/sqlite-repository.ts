import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { RepositorioClientes } from '../application/ports.js';

import type {
  Direccion,
  DatosDireccion,
  TipoDireccion
} from '../domain/modelos.js';

export class RepositorioSqlite implements RepositorioClientes {
  private readonly baseDatos: DatabaseSync;

  constructor(rutaArchivo = './data/customer.sqlite') {
    if (rutaArchivo !== ':memory:') {
      mkdirSync(dirname(rutaArchivo), { recursive: true });
    }

    this.baseDatos = new DatabaseSync(rutaArchivo);

    const esquema = readFileSync(
      new URL('./schema.sql', import.meta.url),
      'utf8'
    );

    this.baseDatos.exec(esquema);
  }

  crearDireccion(direccion: Direccion): Direccion {
    const fila = this.baseDatos.prepare(`
      INSERT INTO direcciones (
        id,
        clienteId,
        alias,
        direccion,
        latitud,
        longitud,
        tipo,
        uso,
        fechaCreacion,
        fechaActualizacion
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      direccion.id,
      direccion.clienteId,
      direccion.alias,
      direccion.direccion,
      direccion.latitud,
      direccion.longitud,
      direccion.tipo,
      direccion.uso,
      direccion.fechaCreacion,
      direccion.fechaActualizacion
    );

    return fila as unknown as Direccion;
  }

  obtenerDireccion(
    clienteId: string,
    id: string
  ): Direccion | undefined {
    const fila = this.baseDatos.prepare(`
      SELECT *
      FROM direcciones
      WHERE clienteId = ? AND id = ?
    `).get(clienteId, id);

    return fila as unknown as Direccion | undefined;
  }

  listarDirecciones(
    clienteId: string,
    tipo?: TipoDireccion
  ): Direccion[] {
    const filas = this.baseDatos.prepare(`
      SELECT *
      FROM direcciones
      WHERE clienteId = ?
        AND (? IS NULL OR tipo = ?)
      ORDER BY fechaCreacion DESC, id DESC
    `).all(
      clienteId,
      tipo ?? null,
      tipo ?? null
    );

    return filas as unknown as Direccion[];
  }

  actualizarDireccion(
    clienteId: string,
    id: string,
    datosEntrada: DatosDireccion & {
      fechaActualizacion: string;
    }
  ): Direccion | undefined {
    const fila = this.baseDatos.prepare(`
      UPDATE direcciones
      SET alias = ?,
          direccion = ?,
          latitud = ?,
          longitud = ?,
          tipo = ?,
          uso = ?,
          fechaActualizacion = ?
      WHERE clienteId = ? AND id = ?
      RETURNING *
    `).get(
      datosEntrada.alias,
      datosEntrada.direccion,
      datosEntrada.latitud,
      datosEntrada.longitud,
      datosEntrada.tipo,
      datosEntrada.uso,
      datosEntrada.fechaActualizacion,
      clienteId,
      id
    );

    return fila as unknown as Direccion | undefined;
  }

  eliminarDireccion(clienteId: string, id: string): boolean {
    const resultado = this.baseDatos.prepare(`
      DELETE FROM direcciones
      WHERE clienteId = ? AND id = ?
    `).run(clienteId, id);

    return resultado.changes > 0;
  }

  estaDisponible(): boolean {
    return this.baseDatos.prepare('SELECT 1 AS ok').get()?.ok === 1;
  }

  cerrar(): void {
    this.baseDatos.close();
  }
}