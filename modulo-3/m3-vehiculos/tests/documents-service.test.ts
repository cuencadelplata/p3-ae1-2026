import { describe, jest, beforeEach, it, expect } from "@jest/globals";

// Licencia de conducir con foto de frente y dorso (campo opcional "cara").
jest.unstable_mockModule("../src/documents/documents-repository.js", () => ({
  insertarDocumento: jest.fn(async (datos: any) => ({
    ...datos,
    id: "doc-1",
    fechaVencimiento: new Date(datos.fechaVencimiento),
    estado: "PENDIENTE",
    createdAt: new Date(),
  })),
  listarDocumentosPorConductor: jest.fn(),
  buscarDocumentoDeConductor: jest.fn(),
}));
jest.unstable_mockModule("../src/vehiculos/vehiculo-repository.js", () => ({
  buscarVehiculoDeConductor: jest.fn(),
}));
jest.unstable_mockModule("../src/documents/documents.events.js", () => ({
  publicarDocumentoRegistrado: jest.fn(async () => undefined),
}));

const repository = await import("../src/documents/documents-repository.js");
const vehiculos = await import("../src/vehiculos/vehiculo-repository.js");
const { registrarDocumento } = await import("../src/documents/documents-service.js");
const { AppError } = await import("../src/errors/AppError.js");

const anioQueViene = new Date().getFullYear() + 2;
const base = {
  tipoDocumento: "LICENCIA_CONDUCIR",
  numeroDocumento: "LIC-123",
  fechaVencimiento: `${anioQueViene}-03-15`,
  archivoUrl: "data:image/jpeg;base64,AAAA",
};

describe("registrarDocumento - cara de la licencia", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("guarda la cara FRENTE/DORSO normalizada en mayúscula", async () => {
    const frente = await registrarDocumento("101", { ...base, cara: "frente" });
    const dorso = await registrarDocumento("101", { ...base, cara: "DORSO" });

    expect(frente.cara).toBe("FRENTE");
    expect(dorso.cara).toBe("DORSO");
    expect((repository.insertarDocumento as jest.Mock).mock.calls[0]![0]).toMatchObject({
      driverId: "101",
      tipoDocumento: "LICENCIA_CONDUCIR",
      cara: "FRENTE",
      vehicleId: null,
    });
  });

  it("sin cara sigue funcionando como antes (cara null)", async () => {
    const doc = await registrarDocumento("101", base);
    expect(doc.cara).toBeNull();
  });

  it("rechaza una cara inválida", async () => {
    await expect(registrarDocumento("101", { ...base, cara: "COSTADO" })).rejects.toThrow(
      "La cara tiene que ser FRENTE o DORSO",
    );
    expect(repository.insertarDocumento).not.toHaveBeenCalled();
  });

  it("acepta cara en la cédula del vehículo, asociada al vehicleId", async () => {
    (vehiculos.buscarVehiculoDeConductor as jest.Mock).mockResolvedValue({ id: "veh-1", driverId: "101" } as never);

    const dorso = await registrarDocumento("101", {
      ...base,
      tipoDocumento: "CEDULA_VEHICULO",
      vehicleId: "veh-1",
      cara: "dorso",
    });

    expect(vehiculos.buscarVehiculoDeConductor).toHaveBeenCalledWith("101", "veh-1");
    expect(dorso).toMatchObject({ tipoDocumento: "CEDULA_VEHICULO", vehicleId: "veh-1", cara: "DORSO" });
  });

  it("la cédula con cara sigue exigiendo vehicleId", async () => {
    await expect(
      registrarDocumento("101", { ...base, tipoDocumento: "CEDULA_VEHICULO", cara: "FRENTE" }),
    ).rejects.toThrow("El documento CEDULA_VEHICULO necesita un vehicleId");
  });

  it("rechaza cara en documentos que no son licencia ni cédula", async () => {
    (vehiculos.buscarVehiculoDeConductor as jest.Mock).mockResolvedValue({ id: "veh-1", driverId: "101" } as never);
    const promesa = registrarDocumento("101", {
      ...base,
      tipoDocumento: "SEGURO_VEHICULO",
      vehicleId: "veh-1",
      cara: "FRENTE",
    });
    await expect(promesa).rejects.toBeInstanceOf(AppError);
    await expect(promesa).rejects.toThrow("Solo la licencia y la cédula del vehículo llevan cara");
  });
});
