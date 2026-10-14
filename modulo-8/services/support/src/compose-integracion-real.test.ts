import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

// compose.integracion-real.yaml une m8-app a las redes de M6 y M1, donde
// también hay servicios llamados "redis" y "rabbitmq". Toda variable de m8-app
// que nombre infraestructura de M8 tiene que estar redefinida ahí con un alias
// exclusivo de la red de M8; si no, podría resolver al servicio de otro módulo.
const M8_DIR = path.resolve(process.cwd(), '../..');
const INFRA = ['postgres', 'redis', 'rabbitmq'] as const;

type Compose = {
  services: Record<string, { environment?: Record<string, unknown>; networks?: unknown }>;
};

function leer(archivo: string): Compose {
  return YAML.parse(fs.readFileSync(path.join(M8_DIR, archivo), 'utf8'));
}

// Hostname de infraestructura dentro de una URL: después de "@" o de "//".
function hostDeInfra(valor: unknown): (typeof INFRA)[number] | undefined {
  if (typeof valor !== 'string') {
    return undefined;
  }
  return INFRA.find((host) => new RegExp(`(@|//)${host}(:|/|$)`).test(valor));
}

function conAlias(valor: string, host: string): string {
  return valor.replace(new RegExp(`(@|//)${host}(:|/|$)`), `$1m8-${host}$2`);
}

const base = leer('compose.yaml');
const override = leer('compose.integracion-real.yaml');
const entornoBase = base.services['m8-app'].environment ?? {};
const entornoOverride = override.services['m8-app'].environment ?? {};
const variablesDeInfra = Object.entries(entornoBase).filter(([, valor]) => hostDeInfra(valor) !== undefined);

describe('compose.integracion-real.yaml frente a compose.yaml', () => {
  it('compose.yaml tiene variables de m8-app que nombran postgres, redis y rabbitmq', () => {
    const hosts = new Set(variablesDeInfra.map(([, valor]) => hostDeInfra(valor)));

    expect([...hosts].sort()).toEqual([...INFRA].sort());
  });

  it.each(variablesDeInfra.map(([nombre]) => nombre))('%s está redefinida en el override', (nombre) => {
    expect(entornoOverride, `falta ${nombre} en compose.integracion-real.yaml`).toHaveProperty(nombre);
  });

  it.each(variablesDeInfra)('%s es la misma URL de compose.yaml, sólo con el alias m8-*', (nombre, valor) => {
    const host = hostDeInfra(valor)!;

    expect(entornoOverride[nombre]).toBe(conAlias(valor as string, host));
  });

  it('ninguna variable de m8-app en el override apunta a un hostname ambiguo', () => {
    const ambiguas = Object.entries(entornoOverride)
      .filter(([, valor]) => hostDeInfra(valor) !== undefined)
      .map(([nombre]) => nombre);

    expect(ambiguas).toEqual([]);
  });

  it.each(INFRA)('el servicio %s declara el alias m8-%s en la red de M8', (host) => {
    const redes = override.services[host].networks as { default: { aliases: string[] } };

    expect(redes.default.aliases).toContain(`m8-${host}`);
  });

  it('m8-app sigue en la red de M8 además de las de M6 y M1', () => {
    expect(override.services['m8-app'].networks).toEqual(['default', 'm6-real', 'm1-real']);
  });

  it('el override no redefine variables de otros RF', () => {
    const propias = ['M6_TRIPS_URL', 'M6_TIMEOUT_MS', 'SUPPORT_M1_IDENTITY_URL'];
    const esperadas = [...propias, ...variablesDeInfra.map(([nombre]) => nombre)];

    expect(Object.keys(entornoOverride).sort()).toEqual(esperadas.sort());
  });
});
