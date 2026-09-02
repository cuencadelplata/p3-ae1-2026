/**
 * Orquesta un test END-TO-END real contra el contenedor Docker:
 *   1) Construye la imagen (docker build)
 *   2) Levanta un contenedor a partir de esa imagen
 *   3) Espera a que el endpoint /health responda OK (o hace timeout)
 *   4) Corre los tests de Playwright contra ese contenedor
 *   5) Pase o falle, siempre apaga y borra el contenedor al final
 *
 * Uso:
 *   node scripts/run-e2e.js
 *   (o el atajo: npm run test:e2e)
 */

const { spawnSync } = require("child_process");

const IMAGE_NAME = "m7-cargo-cancelacion";
const CONTAINER_NAME = "m7-cargo-cancelacion-e2e";
const PORT = 3007;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    throw new Error(`El comando "${cmd} ${args.join(" ")}" fallo con codigo ${result.status}`);
  }
}

function runIgnoringErrors(cmd, args) {
  spawnSync(cmd, args, { stdio: "ignore", shell: true });
}

async function esperarHealthy() {
  const inicio = Date.now();
  while (Date.now() - inicio < MAX_WAIT_MS) {
    try {
      const resp = await fetch(HEALTH_URL);
      if (resp.ok) {
        console.log(`\nAPI healthy en ${HEALTH_URL}`);
        return;
      }
    } catch {
      // el contenedor todavia no esta listo, seguimos esperando
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`La API no respondio OK en ${HEALTH_URL} despues de ${MAX_WAIT_MS / 1000}s`);
}

function limpiarContenedorPrevio() {
  runIgnoringErrors("docker", ["rm", "-f", CONTAINER_NAME]);
}

async function main() {
  limpiarContenedorPrevio();

  let testExitCode = 1;
  try {
    console.log("== 1) Construyendo la imagen Docker ==");
    run("docker", ["build", "-t", IMAGE_NAME, "."]);

    console.log("\n== 2) Levantando el contenedor para el test E2E ==");
    run("docker", ["run", "-d", "--name", CONTAINER_NAME, "-p", `${PORT}:${PORT}`, IMAGE_NAME]);

    console.log("\n== 3) Esperando a que la API este healthy ==");
    await esperarHealthy();

    console.log("\n== 4) Corriendo la simulacion (Playwright) contra el contenedor ==");
    const playwright = spawnSync("npx", ["playwright", "test"], { stdio: "inherit", shell: true });
    testExitCode = playwright.status ?? 1;
  } finally {
    console.log("\n== 5) Apagando y borrando el contenedor de prueba ==");
    runIgnoringErrors("docker", ["rm", "-f", CONTAINER_NAME]);
  }

  process.exit(testExitCode);
}

main().catch((err) => {
  console.error("\nFallo el flujo E2E:", err.message);
  runIgnoringErrors("docker", ["rm", "-f", CONTAINER_NAME]);
  process.exit(1);
});