import { describe, expect, it } from 'vitest';
import { assertSchemaIdentifier, loadSupportDbConfig } from './config.js';

const URL = 'postgres://m8_support:secreto@localhost:5432/m8';

describe('loadSupportDbConfig', () => {
  it('exige SUPPORT_DATABASE_URL: no hay almacenamiento alternativo', () => {
    expect(() => loadSupportDbConfig({})).toThrow(/SUPPORT_DATABASE_URL es obligatoria/);
    expect(() => loadSupportDbConfig({ SUPPORT_DATABASE_URL: '' })).toThrow(/SUPPORT_DATABASE_URL es obligatoria/);
  });

  it('usa el schema support por defecto', () => {
    expect(loadSupportDbConfig({ SUPPORT_DATABASE_URL: URL })).toEqual({ databaseUrl: URL, schema: 'support' });
  });

  it('acepta otro schema por SUPPORT_DB_SCHEMA', () => {
    const config = loadSupportDbConfig({ SUPPORT_DATABASE_URL: URL, SUPPORT_DB_SCHEMA: 'support_test_ab12' });

    expect(config.schema).toBe('support_test_ab12');
  });

  it.each([
    ['inyección de SQL', 'support; DROP SCHEMA receipts'],
    ['mayúsculas', 'Support'],
    ['empieza con dígito', '1support'],
    ['con punto', 'receipts.receipts'],
    ['con comillas', '"support"'],
    ['vacío', ''],
    ['más de 63 caracteres', 'a'.repeat(64)],
  ])('rechaza un schema que no es un identificador simple: %s', (_caso, schema) => {
    expect(() => loadSupportDbConfig({ SUPPORT_DATABASE_URL: URL, SUPPORT_DB_SCHEMA: schema })).toThrow(
      /SUPPORT_DB_SCHEMA debe ser un identificador simple/,
    );
  });

  it('no incluye la URL de conexión en el mensaje de error del schema', () => {
    expect(() => assertSchemaIdentifier('Mal Schema')).toThrow(/"Mal Schema"/);
    expect(() => loadSupportDbConfig({ SUPPORT_DATABASE_URL: URL, SUPPORT_DB_SCHEMA: 'Mal' })).not.toThrow(/secreto/);
  });
});
