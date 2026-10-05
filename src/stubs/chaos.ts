import { Router, type RequestHandler, type Router as ExpressRouter } from 'express';
import { z } from 'zod';

export const STUB_NAMES = ['m1', 'soporte', 'm6'] as const;
export type StubName = (typeof STUB_NAMES)[number];

const ChaosRequestSchema = z.object({
  mode: z.literal('down').optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  failRate: z.number().min(0).max(1).optional()
}).strict();

type ChaosState = {
  readonly mode: 'normal' | 'down';
  readonly delayMs: number;
  readonly failRate: number;
};

const NORMAL_STATE = {
  mode: 'normal',
  delayMs: 0,
  failRate: 0
} as const satisfies ChaosState;

const chaosStates = new Map<StubName, ChaosState>();

function currentState(name: StubName): ChaosState {
  return chaosStates.get(name) ?? NORMAL_STATE;
}

function chaosMiddleware(name: StubName): RequestHandler {
  return async (req, res, next) => {
    const state = currentState(name);

    if (state.mode === 'down') {
      req.socket.destroy();
      return;
    }

    if (state.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, state.delayMs));
    }

    if (state.failRate > 0 && Math.random() < state.failRate) {
      res.status(500).json({
        error: 'StubChaosFailure',
        service: name
      });
      return;
    }

    next();
  };
}

export function withChaos(name: StubName, router: ExpressRouter): ExpressRouter {
  const wrappedRouter = Router();

  wrappedRouter.post('/__chaos', (req, res) => {
    const parsed = ChaosRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'ValidationError',
        message: 'La configuración de caos no es válida'
      });
      return;
    }

    const state = {
      mode: parsed.data.mode ?? 'normal',
      delayMs: parsed.data.delayMs ?? 0,
      failRate: parsed.data.failRate ?? 0
    } as const satisfies ChaosState;
    chaosStates.set(name, state);

    res.json({ service: name, chaos: state });
  });

  wrappedRouter.use(chaosMiddleware(name));
  wrappedRouter.use(router);
  return wrappedRouter;
}

export function resetChaos(name?: StubName): void {
  if (name === undefined) {
    chaosStates.clear();
    return;
  }
  chaosStates.delete(name);
}
