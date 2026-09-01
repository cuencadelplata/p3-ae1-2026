import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

import "./vitest-context";

const imageName = "m8-service:e2e";
const containerPort = "3100";
const qrTtlSeconds = "120";
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

function runCommand(command: string, args: string[], stdio: "inherit" | "pipe" = "inherit") {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio,
  });

  if (result.error) {
    throw new Error(`No fue posible ejecutar ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} falló con código ${result.status}.${output ? `\n${output}` : ""}`);
  }

  return result.stdout?.trim() ?? "";
}

function printLogs(containerName: string) {
  spawnSync("docker", ["logs", containerName], { cwd: projectRoot, stdio: "inherit" });
}

function cleanupContainer(containerName: string) {
  spawnSync("docker", ["stop", containerName], { cwd: projectRoot, stdio: "inherit" });
  spawnSync("docker", ["rm", containerName], { cwd: projectRoot, stdio: "inherit" });
}

function getBaseUrl(containerName: string) {
  const portOutput = runCommand("docker", ["port", containerName, `${containerPort}/tcp`], "pipe");
  const match = portOutput.match(/:(\d+)\s*$/);

  if (!match) {
    throw new Error(`No fue posible determinar el puerto host asignado por Docker: ${portOutput}`);
  }

  return `http://127.0.0.1:${match[1]}`;
}

async function waitForServer(baseUrl: string) {
  const deadline = Date.now() + 30_000;
  const readinessRequest = {
    tripId: "e2e-readiness-trip",
    recipientId: "e2e-readiness-recipient",
    eventType: "TRIP_REQUESTED",
    channels: ["PUSH"],
  };

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readinessRequest),
        signal: AbortSignal.timeout(1_000),
      });

      if (response.status === 201) {
        return;
      }
    } catch {
      // El contenedor puede no haber terminado de iniciar.
    }

    await delay(250);
  }

  throw new Error("El servicio no estuvo disponible dentro de 30 segundos.");
}

export default async function setup(project: TestProject) {
  const containerName = `m8-notifications-e2e-${process.pid}-${Date.now()}`;
  let containerStarted = false;

  try {
    runCommand("docker", ["version", "--format", "{{.Server.Version}}"], "pipe");
    runCommand("docker", ["build", "-t", imageName, "."]);
    runCommand(
      "docker",
      [
        "run",
        "-d",
        "--name",
        containerName,
        "-e",
        `PORT=${containerPort}`,
        "-e",
        `QR_TTL_SECONDS=${qrTtlSeconds}`,
        "-p",
        `127.0.0.1::${containerPort}`,
        imageName,
      ],
      "pipe",
    );
    containerStarted = true;

    const baseUrl = getBaseUrl(containerName);
    console.log(`E2E_BASE_URL=${baseUrl}`);
    await waitForServer(baseUrl);
    project.provide("e2eBaseUrl", baseUrl);
  } catch (error) {
    if (containerStarted) {
      console.error("\nLogs del contenedor E2E:");
      printLogs(containerName);
      cleanupContainer(containerName);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`No fue posible preparar la infraestructura E2E. ${message}`);
  }

  return async () => {
    cleanupContainer(containerName);
  };
}
