import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

const mode = process.argv[2];
const envFile = ".env";

if (mode !== "dependencies" && mode !== "stack") {
  throw new Error("Uso: node scripts/ensure-test-infrastructure.mjs <dependencies|stack>");
}

if (!existsSync(envFile)) {
  throw new Error("Falta modulo8/.env; crearlo a partir de .env.example y definir claves privadas antes de iniciar las pruebas.");
}

const config = parse(readFileSync(envFile));
const requiredSecrets = [
  "RABBITMQ_USER", "RABBITMQ_PASSWORD", "M8_RABBITMQ_URL", "RABBITMQ_URL",
  "POSTGRES_PASSWORD", "RECEIPTS_DB_PASSWORD", "NOTIFICATIONS_DB_PASSWORD",
  "SUPPORT_DB_PASSWORD", "DELIVERY_DB_PASSWORD", "QR_INTERNAL_API_KEY",
  "M1_JWT_SECRET", "M2_INTERNAL_API_KEY",
];
for (const name of requiredSecrets) {
  if (!config[name] || config[name].includes("replace-with-")) {
    throw new Error(`Configurar ${name} en modulo8/.env antes de iniciar Compose.`);
  }
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
const dependencies = ["postgres", "redis", "rabbitmq", "m1-identity-sandbox", "m7-payments-sandbox"];

if (mode === "stack") {
  runDocker([...compose, "up", "-d", "--build", "--wait"]);
} else {
  runDocker([...compose, "up", "-d", "--wait", ...dependencies]);
}

// El volumen puede existir desde antes de incorporar RF8.1. El inicializador
// es idempotente y garantiza tanto el schema de runtime como la base aislada
// usada por la suite de integracion.
runDocker([...compose, "exec", "-T", "postgres", "sh", "/docker-entrypoint-initdb.d/03-notifications.sh"]);
