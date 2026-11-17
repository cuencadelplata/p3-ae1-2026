const http = require("http");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const container = process.env.KAFKA_CONTAINER || "p3-m3-kafka";

function dockerCli(args) {
  return execFileAsync("docker", args, { timeout: 30000, windowsHide: true });
}

function dockerSocket() {
  return process.platform === "win32" ? "\\\\.\\pipe\\docker_engine" : "/var/run/docker.sock";
}

function dockerApi(method, apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: dockerSocket(), path: apiPath, method, timeout: 20000 },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
            return;
          }
          reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 180)}`));
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

function missingContainer(error) {
  return /No such object|no such container|404|not found/i.test(error.message || "");
}

async function isRunning() {
  try {
    const { stdout } = await dockerCli(["inspect", "-f", "{{.State.Running}}", container]);
    return String(stdout).trim() === "true";
  } catch (cliError) {
    if (missingContainer(cliError)) return false;
    try {
      const body = await dockerApi("GET", `/containers/${container}/json`);
      return JSON.parse(body).State.Running === true;
    } catch (apiError) {
      if (missingContainer(apiError)) return false;
      throw apiError;
    }
  }
}

async function startKafka() {
  try {
    if (await isRunning()) {
      return true;
    }
    try {
      await dockerCli(["start", container]);
    } catch (_cliError) {
      await dockerApi("POST", `/containers/${container}/start`);
    }
    console.log(`[Kafka] Servicio ${container} iniciado`);
    return true;
  } catch (error) {
    console.warn(`[Kafka] No se pudo iniciar ${container}: ${error.message}`);
    return false;
  }
}

async function stopKafka() {
  try {
    if (!(await isRunning())) {
      return true;
    }
    try {
      await dockerCli(["stop", container]);
    } catch (_cliError) {
      await dockerApi("POST", `/containers/${container}/stop`);
    }
    console.log(`[Kafka] Servicio ${container} apagado`);
    return true;
  } catch (error) {
    console.warn(`[Kafka] No se pudo apagar ${container}: ${error.message}`);
    return false;
  }
}

module.exports = {
  startKafka,
  stopKafka,
  container
};
