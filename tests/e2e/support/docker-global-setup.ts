import type { TestProject } from "vitest/node";

import { startE2eService } from "./docker-service";
import "./vitest-context";

export default async function setup(project: TestProject) {
  const service = await startE2eService();
  project.provide("e2eBaseUrl", service.baseUrl);

  return service.cleanup;
}
