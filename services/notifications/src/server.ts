import { createApp } from "./app";
import { createRf81Application } from "./notifications/rf81-application";

const defaultPort = 3000;
const configuredPort = Number(process.env.PORT);
const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
  ? configuredPort
  : defaultPort;

async function bootstrap(): Promise<void> {
  const rf81Application = createRf81Application({
    databaseUrl: process.env.NOTIFICATIONS_DATABASE_URL,
  });

  await rf81Application.initialize();

  const server = createApp().listen(port, () => {
    console.log(`Notifications Processing service listening on port ${port}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`Notifications Processing service shutting down (${signal})`);
    server.close((error) => {
      rf81Application.close()
        .catch((closeError: unknown) => {
          console.error("Error closing Notifications resources", closeError);
        })
        .finally(() => {
          if (error) {
            console.error("Error closing Notifications HTTP server", error);
            process.exitCode = 1;
          }
        });
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((error: unknown) => {
  console.error("Notifications Processing service failed to start", error);
  process.exitCode = 1;
});
