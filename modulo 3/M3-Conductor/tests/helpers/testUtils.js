/**
 * Utilidades para unit tests con Playwright (sin Jest).
 * Playwright no soporta jest.mock(); se usan mocks en require.cache + spies.
 */

function createMockFn(defaultImpl) {
  const state = {
    calls: [],
    impl: typeof defaultImpl === 'function' ? defaultImpl : null,
    resolvedValue: undefined,
    rejectedValue: undefined,
    hasResolved: false,
    hasRejected: false
  };

  const fn = function mockFn(...args) {
    state.calls.push(args);
    if (state.impl) return state.impl.apply(this, args);
    if (state.hasRejected) return Promise.reject(state.rejectedValue);
    if (state.hasResolved) return Promise.resolve(state.resolvedValue);
    return Promise.resolve(undefined);
  };

  fn.mock = state;
  fn.mockClear = () => {
    state.calls = [];
  };
  fn.mockReset = () => {
    state.calls = [];
    state.impl = null;
    state.hasResolved = false;
    state.hasRejected = false;
    state.resolvedValue = undefined;
    state.rejectedValue = undefined;
  };
  fn.mockResolvedValue = (value) => {
    state.hasResolved = true;
    state.hasRejected = false;
    state.resolvedValue = value;
    state.impl = null;
    return fn;
  };
  fn.mockRejectedValue = (error) => {
    state.hasRejected = true;
    state.hasResolved = false;
    state.rejectedValue = error;
    state.impl = null;
    return fn;
  };
  fn.mockImplementation = (impl) => {
    state.impl = impl;
    state.hasResolved = false;
    state.hasRejected = false;
    return fn;
  };
  fn.mockReturnValue = (value) => {
    state.impl = () => value;
    return fn;
  };
  fn.mockReturnThis = () => {
    state.impl = function returnThis() {
      return this;
    };
    return fn;
  };

  Object.defineProperty(fn, 'calls', {
    get: () => state.calls
  });

  return fn;
}

function mockModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: []
  };
  return exports;
}

function clearModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch (_err) {
    // ignore unresolved paths
  }
}

function createFakeRedis() {
  return {
    get: createMockFn().mockResolvedValue(null),
    set: createMockFn().mockResolvedValue('OK'),
    exists: createMockFn().mockResolvedValue(0),
    smembers: createMockFn().mockResolvedValue([]),
    sadd: createMockFn().mockResolvedValue(1),
    lrange: createMockFn().mockResolvedValue([]),
    rpush: createMockFn().mockResolvedValue(1),
    on: createMockFn(),
    quit: createMockFn().mockResolvedValue('OK'),
    disconnect: createMockFn()
  };
}

function createRes() {
  const res = {
    status: createMockFn(),
    json: createMockFn()
  };
  res.status.mockReturnThis();
  res.json.mockReturnThis();
  return res;
}

function clearAllMocks(...fns) {
  for (const fn of fns) {
    if (fn && typeof fn.mockClear === 'function') fn.mockClear();
  }
}

module.exports = {
  createMockFn,
  mockModule,
  clearModule,
  createFakeRedis,
  createRes,
  clearAllMocks
};
