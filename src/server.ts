import { createApp } from "./app";
import { registerQrRoutes } from "./qr/qr.controller";

const app = createApp(registerQrRoutes);
const defaultPort = 3000;
const configuredPort = Number(process.env.PORT);
const port =
  Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : defaultPort;

app.listen(port, () => {
  console.log(`M8 service listening on port ${port}`);
});
