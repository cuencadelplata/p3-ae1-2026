import type { Express, Router } from 'express';
import { withChaos, type StubName } from './chaos.js';
import { m1StubRouter } from './m1.stub.js';

export type StubRegistration = {
  readonly name: StubName;
  readonly router: Router;
};

export function stubsEnabled(): boolean {
  return process.env.STUBS_ENABLED === 'true';
}

export function mountStubs(
  app: Express,
  additionalStubs: readonly StubRegistration[] = []
): void {
  if (!stubsEnabled()) return;

  const registrations: readonly StubRegistration[] = [
    { name: 'm1', router: m1StubRouter },
    ...additionalStubs
  ];

  for (const registration of registrations) {
    app.use(`/__stubs/${registration.name}`, withChaos(registration.name, registration.router));
  }
}
