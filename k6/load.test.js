import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "15s", target: 10 }, // Sube a 10 usuarios virtuales en 15s
    { duration: "30s", target: 20 }, // Mantiene 20 usuarios simultáneos por 30s
    { duration: "15s", target: 0 }, // Baja a 0 progresivamente
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"], // 95% de las peticiones deben responder en menos de 500ms
    http_req_failed: ["rate<0.01"], // Menos del 1% de errores permitidos
  },
};

export default function () {
  // Prueba contra el servicio de conductores (puerto 5000)
  const resCond = http.get("http://m3-conductor-api:5000/api/conductores");
  check(resCond, {
    "conductores status 200": (r) => r.status === 200,
  });

  // Prueba contra el servicio de vehículos (puerto 8083)
  const resVeh = http.get("http://m3-vehiculos:8083/api/vehiculos");
  check(resVeh, {
    "vehiculos status 200": (r) => r.status === 200,
  });

  sleep(1);
}
