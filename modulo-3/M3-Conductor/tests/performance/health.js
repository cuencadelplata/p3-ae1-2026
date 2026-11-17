import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "20s",

  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.99"]
  }
};

const BASE_URL = __ENV.BASE_URL || "http://api:3000";

export default function () {
  const response = http.get(`${BASE_URL}/health`);

  check(response, {
    "API responde HTTP 200": (r) => r.status === 200
  });

  sleep(1);
}