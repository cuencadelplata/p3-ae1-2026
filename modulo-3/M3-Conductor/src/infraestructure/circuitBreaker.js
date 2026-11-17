const CLOSED = "CLOSED";
const OPEN = "OPEN";
const HALF_OPEN = "HALF_OPEN";

function createCircuitBreaker({ failureThreshold = 2, successThreshold = 2 } = {}) {
  let state = CLOSED;
  let failures = 0;
  let successes = 0;
  const listeners = [];

  function change(next) {
    if (next === state) return;
    const previous = state;
    state = next;
    for (const listener of listeners) {
      listener(previous, next);
    }
  }

  return {
    state() {
      return state;
    },

    allowsRabbit() {
      return state === CLOSED;
    },

    recordFailure() {
      successes = 0;
      failures += 1;
      if (state === HALF_OPEN || failures >= failureThreshold) {
        change(OPEN);
      }
    },

    recordSuccess() {
      failures = 0;
      if (state === CLOSED) return;
      successes += 1;
      if (state === OPEN) {
        change(HALF_OPEN);
      }
      if (successes >= successThreshold && state !== CLOSED) {
        successes = 0;
        change(CLOSED);
      }
    },

    open() {
      failures = failureThreshold;
      successes = 0;
      change(OPEN);
    },

    onChange(listener) {
      listeners.push(listener);
    }
  };
}

module.exports = {
  CLOSED,
  OPEN,
  HALF_OPEN,
  createCircuitBreaker
};
