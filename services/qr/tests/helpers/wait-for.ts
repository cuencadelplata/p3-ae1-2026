// Sondea una condición hasta que se cumple o vence el tope. Reemplaza las esperas fijas: la
// prueba avanza apenas la condición se cumple y falla con un mensaje claro si no se cumple.
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs?: number; what: string },
): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  const intervalMs = options.intervalMs ?? 25;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`No se cumplió en ${options.timeoutMs} ms: ${options.what}.`);
}
