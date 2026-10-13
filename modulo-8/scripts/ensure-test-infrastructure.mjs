import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const envFile = ".env";

if (mode !== "dependencies" && mode !== "stack") {
  throw new Error("Uso: node scripts/ensure-test-infrastructure.mjs <dependencies|stack>");
}

if (!existsSync(envFile)) {
  throw new Error("Falta modulo-8/.env. Crear el archivo a partir de .env.example antes de ejecutar pruebas.");
}

function runDocker(args) {
  const result = spawnSync("docker", args, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const compose = ["compose", "--env-file", envFile];
const dependencies = ["postgres", "redis", "rabbitmq", "fiscal-sandbox", "m1-identity-sandbox", "m7-payments-sandbox"];

if (mode === "stack") {
  runDocker([...compose, "up", "-d", "--build", "--wait"]);
} else {
  runDocker([...compose, "up", "-d", "--wait", ...dependencies]);
}

// El volumen puede existir desde antes de incorporar RF8.1. El inicializador
// es idempotente y garantiza tanto el schema de runtime como la base aislada
// usada por la suite de integracion.
runDocker([...compose, "exec", "-T", "postgres", "sh", "/docker-entrypoint-initdb.d/03-notifications.sh"]);
