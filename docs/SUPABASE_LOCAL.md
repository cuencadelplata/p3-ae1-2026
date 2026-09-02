# Supabase local para M9

M9 usa exclusivamente una instancia local de Supabase durante la ejecución y las pruebas de AE1. No necesita conectarse al proyecto cloud ni compartir sus credenciales.

## Componentes

Supabase CLI inicia PostgreSQL, PostgREST y el gateway de API en contenedores locales. Los servicios que M9 no utiliza (Auth, Storage, Realtime, Studio, Analytics y auxiliares) se excluyen para reducir el consumo de recursos.

El esquema reproducible está compuesto por:

- `supabase/config.toml`: puertos y versión local de PostgreSQL;
- `supabase/migrations/`: enums, tabla, permisos y políticas RLS;
- `supabase/seed.sql`: una reserva completamente ficticia con fecha lejana;
- `scripts/lib/supabase-cli.mjs`: resolución multiplataforma del binario fijado en `package-lock.json`.

Los archivos internos `supabase/.temp/` y `supabase/.branches/` no se versionan.

## Inicio completo

Requisitos: Node.js 22, npm y Docker Desktop funcionando.

```bash
npm install
npm run local:up
```

El comando inicia Supabase local, obtiene la clave server-only local sin imprimirla ni guardarla, y la entrega al contenedor M9 solo durante el proceso de Compose.

Servicios accesibles desde el host:

- UI y API M9: `http://localhost:3000`;
- Swagger UI: `http://localhost:3000/docs/`;
- salud de M9: `http://localhost:3000/health`;
- Data API local de Supabase: `http://localhost:54321`.

M5 y M7 son stubs internos de la red `reservas-network` y no publican puertos al host.

## Reconstrucción de la base

```bash
npm run local:reset
```

Este comando elimina los datos de la base local, vuelve a aplicar todas las migraciones y ejecuta el seed. Nunca utiliza `--linked`, por lo que no afecta un proyecto remoto.

## Pruebas E2E

```bash
npm run test:e2e
```

La prueba E2E:

1. inicia Supabase local;
2. reconstruye la base desde migraciones y seed;
3. construye e inicia M9, M5 stub y M7 stub con Compose;
4. consume exclusivamente la UI y la API pública de M9;
5. comprueba CRUD, tarifa M7 y activación automática M5;
6. desmonta Compose y elimina los volúmenes locales de Supabase.

El archivo de prueba no importa `@supabase/supabase-js` ni ejecuta borrados directos. La limpieza se consigue descartando la base local completa.

> `npm run test:e2e` destruye cualquier dato existente en la instancia Supabase local de este repositorio. No afecta bases remotas.

## Detención y limpieza

Para detener conservando los datos locales:

```bash
npm run local:down
```

Para detener y eliminar los datos locales:

```bash
npm run local:clean
```

Las imágenes Docker descargadas permanecen en la caché local y pueden reutilizarse.

## Ejecución directa sin Compose

Solo si se desea ejecutar M9 con `npm run dev`, copiar `.env.example` a `.env` y reemplazar `SUPABASE_KEY` por la clave local informada por Supabase CLI. `.env` está ignorado por Git. La clave remota nunca debe utilizarse para la entrega.

## Seguridad

- La tabla `public.reservas` tiene RLS habilitado.
- La migración incluye grants explícitos para que la Data API no dependa de la exposición automática de tablas.
- Las políticas de usuarios comparan `auth.uid()` con `cliente_id`.
- M9 usa la clave server-only únicamente en backend para ejecutar el scheduler global.
- Ninguna clave se incluye en migraciones, seed, Compose, Dockerfile o documentación.
- El stack local es solo para desarrollo y evaluación; no debe exponerse a Internet.
