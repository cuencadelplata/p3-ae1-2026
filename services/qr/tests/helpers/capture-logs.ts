import { vi } from "vitest";

export interface CapturedLogs {
  // Líneas tal como se escribieron, para buscar datos que no deben aparecer.
  readonly lines: string[];
  // Las mismas líneas interpretadas como JSON.
  entries(): Record<string, unknown>[];
  restore(): void;
}

// Captura lo que el servicio escribe en consola con los niveles que usa el logger.
export function captureLogs(): CapturedLogs {
  const lines: string[] = [];
  const spies = (["info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );

  return {
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}
