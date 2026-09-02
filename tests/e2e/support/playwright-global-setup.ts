import { startE2eService } from "./docker-service";

export default async function setupPlaywright() {
  const service = await startE2eService();
  process.env.M8_E2E_BASE_URL = service.baseUrl;

  return () => {
    delete process.env.M8_E2E_BASE_URL;
    service.cleanup();
  };
}
