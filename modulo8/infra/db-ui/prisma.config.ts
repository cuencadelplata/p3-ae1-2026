import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} debe estar configurada en el .env local.`);
  }
  return value;
}

const url = new URL('postgresql://localhost');
url.username = required('POSTGRES_USER');
url.password = required('POSTGRES_PASSWORD');
url.port = process.env.POSTGRES_HOST_PORT || '5432';
url.pathname = `/${required('POSTGRES_DB')}`;

export default defineConfig({
  datasource: { url: url.toString() },
});
