import { describe, expect, it, vi } from "vitest";
import { createM3ActiveVehicleLookup } from "../../../src/notifications/m3-vehicle.client";

const activeAuto = {
  id: "veh-001", driverId: "101", patente: "AB123CD", marca: "Toyota",
  modelo: "Corolla", tipoServicio: "AUTO", activo: true,
};

describe("consulta opcional del vehiculo activo en M3", () => {
  it("usa la ruta real y selecciona el unico vehiculo activo del mismo usuario y tipo", async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { ...activeAuto, id: "anterior", activo: false },
        activeAuto,
        { ...activeAuto, id: "moto", tipoServicio: "MOTO" },
      ],
    });
    const lookup = createM3ActiveVehicleLookup("http://m3-vehiculos:8083/", request as typeof fetch);
    expect(await lookup(101, "AUTO")).toEqual({ patente: "AB123CD", marca: "Toyota", modelo: "Corolla" });
    expect(request).toHaveBeenCalledWith("http://m3-vehiculos:8083/api/v1/drivers/101/vehicles", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("descarta identidad diferente, varios activos y fallas de M3", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ ...activeAuto, driverId: "102" }] });
    const lookup = createM3ActiveVehicleLookup("http://m3-vehiculos:8083", request as typeof fetch);
    expect(await lookup(101, "AUTO")).toBeNull();
    request.mockResolvedValue({ ok: true, json: async () => [activeAuto, { ...activeAuto, id: "veh-002" }] });
    expect(await lookup(101, "AUTO")).toBeNull();
    request.mockRejectedValue(new Error("M3 no disponible"));
    expect(await lookup(101, "AUTO")).toBeNull();
  });
});
