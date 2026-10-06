# M7: Tarifas, Pagos y Liquidaciones (AE2 Integrado)

Backend unificado que consolida todos los requerimientos funcionales del **Módulo 7**, orquestado con **Docker Compose** e implementando el patrón de diseño **Circuit Breaker** para resiliencia ante caídas de Backing Services.

---

## Requisitos previos

- Docker y Docker Compose instalados
- Node.js 20+
- npm

---

## Cómo ejecutar

### 1. Clonar el repositorio

```bash
git clone https://github.com/cuencadelplata/p3-ae1-2026.git
cd p3-ae1-2026
git checkout M7--Tarifas,-Pagos-y-Liquidaciones
```

### 2. Crear el archivo .env

```bash
cat > .env << 'ENVEOF'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/historial
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
CARGO_CANCELACION_URL=http://localhost:3007
SUPABASE_URL=https://ljuhdtbwhoskyeowrlvr.supabase.co
SUPABASE_KEY=TU_KEY_DE_SUPABASE
ENVEOF
```

### 3. Levantar los servicios

```bash
docker compose up --build -d
```

### 4. Verificar que todo está corriendo

```bash
docker compose ps
```

### 5. Verificar que la app conectó (esperar ~20 segundos)

```bash
docker compose logs m7-app --tail=20
```

Deberías ver:
- `[postgres] Tablas de base de datos verificadas/creadas con éxito.`
- `[redis] Conectado exitosamente.`
- `[rabbit] Conectado exitosamente y escuchando eventos en RabbitMQ.`

### 6. Instalar dependencias

```bash
npm install
npx playwright install --with-deps chromium
```

### 7. Ejecutar los tests unitarios

```bash
npm run test:unit
```

### 8. Ejecutar los tests e2e

```bash
npm run test:e2e
```

---

## Endpoints principales

| RF | Endpoint | Método |
|---|---|---|
| RF-7.1 | `/tarifas/estimacion` | POST |
| RF-7.2 | `/metodo-pago` | POST / GET |
| RF-7.3 | `/metodo-pago/:viajeId/autorizar` | POST |
| RF-7.4 | `/tarifas/cancelacion` | POST |
| RF-7.5 | `/pagos/:idOrden/duplicado` | GET |
| RF-7.6 | Consumer RabbitMQ (evento `cancelacion_cliente`) | - |
| RF-7.7 | `/operations` | GET / POST / PATCH |

- **Documentación interactiva**: `http://localhost:3000/docs`
- **Healthcheck**: `http://localhost:3000/health`
- **Panel RabbitMQ**: `http://localhost:15672` (guest/guest)

---

## Detener los servicios

```bash
docker compose down
```

---

## Imagen Docker

```bash
docker pull aylen0/m7-tarifas-ae2:4.0
```
