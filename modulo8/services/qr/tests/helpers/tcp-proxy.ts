/*
 * Proxy TCP para pruebas de resiliencia: se interpone entre el servicio y un Redis real y
 * permite simular fallas cambiando de modo en caliente.
 *
 * - open: reenvía en ambos sentidos.
 * - closed: corta las conexiones y deja de escuchar (conexión rechazada, como un Redis caído).
 *   Al volver a open escucha de nuevo en el mismo puerto, para que el cliente reconecte solo.
 * - blackhole: acepta y mantiene las conexiones, pero no reenvía nada (Redis colgado).
 * - drop-responses: reenvía los comandos a Redis, que los ejecuta, pero descarta las
 *   respuestas (respuesta perdida).
 *
 * TCP nunca descarta bytes en una conexión viva: una conexión que deja de responder termina
 * cortándose. Por eso, al salir de blackhole o drop-responses el proxy corta las conexiones
 * existentes. Sin ese corte, el cliente quedaría esperando respuestas que nunca van a llegar
 * y emparejaría las siguientes con los comandos equivocados, algo que no ocurre con una red
 * real.
 */
import net from "node:net";

export type ProxyMode = "open" | "closed" | "blackhole" | "drop-responses";

export interface TcpProxy {
  readonly port: number;
  readonly url: string;
  readonly mode: ProxyMode;
  // Bytes enviados por el cliente desde el último cambio de modo (reenviados o descartados).
  readonly clientBytesSinceModeChange: number;
  setMode(mode: ProxyMode): Promise<void>;
  close(): Promise<void>;
}

export async function startTcpProxy(target: { host: string; port: number }): Promise<TcpProxy> {
  const sockets = new Set<net.Socket>();
  let mode: ProxyMode = "open";
  let clientBytes = 0;
  let server: net.Server | undefined;
  let port = 0;

  function track(socket: net.Socket): void {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  }

  function destroyConnections(): void {
    for (const socket of sockets) {
      socket.destroy();
    }
  }

  function onConnection(client: net.Socket): void {
    track(client);
    const upstream = net.connect(target.port, target.host);
    track(upstream);

    client.on("data", (chunk) => {
      clientBytes += chunk.length;
      if (mode === "open" || mode === "drop-responses") {
        upstream.write(chunk);
      }
    });
    upstream.on("data", (chunk) => {
      if (mode === "open") {
        client.write(chunk);
      }
    });
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  }

  function listen(): Promise<void> {
    const next = net.createServer(onConnection);
    return new Promise((resolve, reject) => {
      next.once("error", reject);
      next.listen(port, "127.0.0.1", () => {
        next.off("error", reject);
        server = next;
        port = (next.address() as net.AddressInfo).port;
        resolve();
      });
    });
  }

  function stopListening(): Promise<void> {
    const current = server;
    server = undefined;
    if (current === undefined) {
      return Promise.resolve();
    }
    return new Promise((resolve) => current.close(() => resolve()));
  }

  await listen();

  return {
    get port() {
      return port;
    },
    get url() {
      return `redis://127.0.0.1:${port}`;
    },
    get mode() {
      return mode;
    },
    get clientBytesSinceModeChange() {
      return clientBytes;
    },
    async setMode(next: ProxyMode) {
      const previous = mode;
      mode = next;
      clientBytes = 0;

      if (next === "closed") {
        destroyConnections();
        await stopListening();
        return;
      }
      if (previous === "blackhole" || previous === "drop-responses") {
        destroyConnections();
      }
      if (server === undefined) {
        await listen();
      }
    },
    async close() {
      destroyConnections();
      await stopListening();
    },
  };
}
