/**
 * Setup de los tests de integración HTTP.
 *
 * Los tests heredados de RF-5.2 a RF-5.7 identifican al cliente con el header x-user-id,
 * por eso corren en modo de autenticación SIMULADA (AUTH_MODE=simulated).
 * Los tests de seguridad de RF-5.1 (tests/integration/rf-5.1-auth.integration.test.ts)
 * cambian a AUTH_MODE=jwt de forma explícita para validar la autenticación real.
 */
process.env.AUTH_MODE = process.env.AUTH_MODE || 'simulated';
