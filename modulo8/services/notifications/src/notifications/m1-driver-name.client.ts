export type DriverNameLookup = (driverUserId: number) => Promise<string | null>;

export function createM1DriverNameLookup(baseUrl: string, apiKey: string, fetchDriver: typeof fetch = fetch): DriverNameLookup {
  const base = baseUrl.replace(/\/+$/, "");
  return async (driverUserId) => {
    if (!Number.isSafeInteger(driverUserId) || driverUserId < 1) return null;
    try {
      const response = await fetchDriver(`${base}/auth/usuarios/${driverUserId}/nombre`, {
        headers: { "X-Internal-Api-Key": apiKey },
        signal: AbortSignal.timeout(1000),
        redirect: "error",
      });
      if (!response.ok) return null;
      const profile: unknown = await response.json();
      if (typeof profile !== "object" || profile === null) return null;
      const driver = profile as Record<string, unknown>;
      if (driver.userId !== driverUserId ||
          typeof driver.nombre !== "string" || !driver.nombre.trim() ||
          typeof driver.apellido !== "string" || !driver.apellido.trim()) return null;
      return `${driver.nombre.trim()} ${driver.apellido.trim()}`;
    } catch {
      return null;
    }
  };
}
