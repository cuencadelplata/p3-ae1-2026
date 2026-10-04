import { createApp } from "./app";
import { generateQrDataUrl, generateQrToken } from "./qr-generator";
import { loadQrConfig } from "./qr.config";
import { createQrService } from "./qr.service";
import { createInMemoryQrStore } from "./qr.store";

const defaultPort = 3000;
const configuredPort = Number(process.env.PORT);
const port =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : defaultPort;

// Un QR_TTL_SECONDS inválido falla acá, al arrancar, antes de aceptar solicitudes.
const qrService = createQrService({
  store: createInMemoryQrStore(),
  config: loadQrConfig(),
  generateQrToken,
  generateQrDataUrl,
  now: () => new Date(),
});

const app = createApp({ qrService });

app.listen(port, () => {
  console.log(`QR service listening on port ${port}`);
});
