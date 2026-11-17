export type DriverNameLookup = (driverUserId: number) => Promise<string | null>;

export function createM3DriverNameLookup(baseUrl: string, fetchDriver: typeof fetch = fetch): DriverNameLookup {
  const base = baseUrl.replace(/\/+$/, "");
  return async (driverUserId) => {
    try {
      const response = await fetchDriver(`${base}/api/conductores/${driverUserId}`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) return null;
      const profile: unknown = await response.json();
      if (typeof profile !== "object" || profile === null) return null;
      const driver = profile as Record<string, unknown>;
      if (String(driver.id) !== String(driverUserId) ||
          typeof driver.nombre !== "string" || !driver.nombre.trim() ||
          typeof driver.apellido !== "string" || !driver.apellido.trim()) return null;
      return `${driver.nombre.trim()} ${driver.apellido.trim()}`;
    } catch {
      return null;
    }
  };
}
