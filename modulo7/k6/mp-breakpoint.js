import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const erroresMP = new Counter("errores_mp");

export const options = {
  stages: [
    { duration: "30s", target: 100 },
    { duration: "30s", target: 125 },
    { duration: "30s", target: 150 },
    { duration: "30s", target: 175 },
    { duration: "30s", target: 200 },
    { duration: "30s", target: 225 },
    { duration: "30s", target: 250 },
  ],
  thresholds: {
    "errores_mp": [{ threshold: "rate<0.05", abortOnFail: true }],
  },
};

const MP_PUBLIC_KEY = "TEST-bc8db768-1690-493a-9cfb-408e8646c0d1";
const HEADERS_JSON  = { "Content-Type": "application/json" };

export default function () {
  const res = http.post(
    `https://api.mercadopago.com/v1/card_tokens?public_key=${MP_PUBLIC_KEY}`,
    JSON.stringify({
      card_number: "4509953566233704", security_code: "123",
      expiration_month: 11, expiration_year: 2030,
      cardholder: { name: "APRO", identification: { type: "DNI", number: "12345678" } },
    }),
    { headers: HEADERS_JSON }
  );

  const ok = check(res, { "token generado": (r) => r.status === 200 || r.status === 201 });
  if (!ok) erroresMP.add(1);
  sleep(1);
}