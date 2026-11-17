import { test, expect } from "@playwright/test";

test("El servicio M3 está funcionando", async ({ request }) => {
  const response = await request.get("/health");

  expect(response.status()).toBe(200);

  const body = await response.json();

  expect(body.status).toBe("ok");
  expect(body.service).toBe("m3-drivers");
});