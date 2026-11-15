# Test de estrés de M1 (AE4)

Script: `login-stress.k6.js`, hecho con [k6](https://k6.io). Dura unos 2 minutos y tiene dos fases:

| Fase | Qué hace | Qué se espera |
| --- | --- | --- |
| Carga (0 a 95 s) | Sube de 0 a 30 usuarios a la vez; cada uno hace login correcto y `GET /auth/me` | Todo responde 200; login p95 < 3 s; `/auth/me` p95 < 1,5 s |
| Ataque (95 a 125 s) | 10 atacantes prueban contraseñas incorrectas sin parar | Casi todo termina en **429** (rate limit de RF-1.2); nunca 200 ni 500 |

## Cómo correrlo

Con M1 levantado (`npm run dev` o Docker) y Docker Desktop abierto, desde la carpeta `modulo-1-identidad-acceso`:

**CMD**

```
docker run --rm -v "%cd%\tests\stress:/scripts" -e BASE_URL=http://host.docker.internal:3001 grafana/k6:1.8.3 run /scripts/login-stress.k6.js
```

**PowerShell**

```
docker run --rm -v "${PWD}\tests\stress:/scripts" -e BASE_URL=http://host.docker.internal:3001 grafana/k6:1.8.3 run /scripts/login-stress.k6.js
```

Si k6 está instalado en la PC (`winget install k6`): `k6 run tests/stress/login-stress.k6.js`.

Mientras corre, el tablero de Grafana Cloud muestra subir los logins por minuto, los pedidos por segundo y el p95. En la fase de ataque aparece la línea de `bloqueado`.

Después del test la IP queda bloqueada 60 segundos: un login en ese tiempo devuelve 429. Es lo esperado.

## Resultado de referencia

Corrido en la PC de desarrollo contra M1 (`npm run dev`) con Redis y RabbitMQ en Docker:

| Medida | Valor |
| --- | --- |
| Pedidos totales | 2.723, con 0 errores (`http_req_failed` 0 %) |
| Duración | 2 min 5 s; las dos fases completas |
| Login (carga) | mediana 1,95 s, p95 2,43 s |
| `/auth/me` (carga) | mediana 42 ms, p95 189 ms |
| Ataque | 1.408 respuestas 429 |
| M1 después del test | Sigue respondiendo: no se cayó |

En una máquina de 2 núcleos el p95 de `/auth/me` subió a 1,09 s (ver abajo por qué).

## Qué muestran los resultados

- **El login es lento a propósito.** Cada login calcula el hash de la contraseña con bcrypt, que está pensado para ser costoso y así encarecer los ataques de fuerza bruta.
- **`/auth/me` espera detrás de los logins.** Es una consulta rápida, pero bajo carga el p95 sube (189 ms en la PC de desarrollo, 1,09 s en una de 2 núcleos). M1 corre en un solo hilo (Node.js) y `bcryptjs` hace el cálculo pesado en ese mismo hilo, así que los pedidos rápidos quedan en la fila detrás de los logins. Mejora posible: usar la librería `bcrypt` nativa, que hace el cálculo en el pool de hilos de libuv.
- **El rate limit frena el ataque, con un margen.** Con 10 atacantes llegando a la vez pasan 6 intentos en lugar de 5: el middleware lee el contador antes de que se sume el fallo, y en una ráfaga varios pedidos leen el mismo valor. Para que sea exacto habría que decidir con el valor que devuelve `INCR`, que es atómico.
