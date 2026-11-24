const { metrics } = require("@opentelemetry/api");

const meter = metrics.getMeter("m3-conductor-api", "1.0.0");

const activeRequests = meter.createUpDownCounter("http.server.active_requests", {
  description: "Requests HTTP en vuelo (saturación de la API)"
});

const requestDuration = meter.createHistogram("http.server.route.duration", {
  description: "Duración de requests por grupo de API (ms)",
  unit: "ms"
});

const requestTotal = meter.createCounter("http.server.route.requests", {
  description: "Total de requests por grupo de API y status"
});

let inflight = 0;
const byGroup = {
  conductor: { inflight: 0, total: 0, errors: 0, lastMs: 0 },
  valoraciones: { inflight: 0, total: 0, errors: 0, lastMs: 0 },
  other: { inflight: 0, total: 0, errors: 0, lastMs: 0 }
};

function classifyRoute(url = "") {
  const pathName = String(url).split("?")[0];
  if (pathName.includes("/valoraciones")) return "valoraciones";
  if (pathName.includes("/conductores") || pathName.includes("/conductor/")) {
    return "conductor";
  }
  return "other";
}

/**
 * Mide latencia y saturación (requests en vuelo) de conductor/valoraciones.
 */
function requestMetrics(req, res, next) {
  if (req.originalUrl === "/health" || req.originalUrl.startsWith("/metrics")) {
    return next();
  }

  const group = classifyRoute(req.originalUrl);
  const attrs = {
    "http.method": req.method,
    "http.route.group": group
  };

  inflight += 1;
  byGroup[group].inflight += 1;
  activeRequests.add(1, attrs);

  const started = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - started;
    const status = res.statusCode;
    const statusAttrs = {
      ...attrs,
      "http.status_code": status
    };

    inflight = Math.max(0, inflight - 1);
    byGroup[group].inflight = Math.max(0, byGroup[group].inflight - 1);
    byGroup[group].total += 1;
    byGroup[group].lastMs = durationMs;
    if (status >= 500) byGroup[group].errors += 1;

    activeRequests.add(-1, attrs);
    requestDuration.record(durationMs, statusAttrs);
    requestTotal.add(1, statusAttrs);
  });

  next();
}

function getSaturationSnapshot() {
  return {
    inflightTotal: inflight,
    groups: {
      conductor: { ...byGroup.conductor },
      valoraciones: { ...byGroup.valoraciones }
    }
  };
}

module.exports = {
  requestMetrics,
  getSaturationSnapshot,
  classifyRoute
};
