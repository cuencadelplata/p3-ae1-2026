import { describe, jest, beforeEach, it, expect } from "@jest/globals";

jest.unstable_mockModule("../../m3-vehiculos/src/vehiculos/vehiculo-repository.js", () => ({
  existePatente: jest.fn(),
  insertarVehiculo: jest.fn(),
  listarVehiculosPorConductor: jest.fn(),
  buscarVehiculoDeConductor: jest.fn(),
  activarVehiculoEnBD: jest.fn(),
}));

const repository = await import("../../m3-vehiculos/src/vehiculos/vehiculo-repository.js");
const { registrarVehiculo, listarVehiculos, obtenerVehiculo, activarVehiculo } =
  await import("../../m3-vehiculos/src/vehiculos/vehiculo-service.js");
const { AppError } = await import("../../m3-vehiculos/src/errors/AppError.js");
const { TipoServicio } = await import("../../m3-vehiculos/src/vehiculos/vehiculo-model.js");

describe("Vehiculo Service Tests", () => {
  const driverId = "driver-abc-123";

  const mockVehiculoValido: any = {
    id: "veh-uuid-1",
    driverId,
    patente: "AB123CD",
    marca: "Toyota",
    modelo: "Corolla",
    anio: 2022,
    tipoServicio: TipoServicio.AUTO,
    activo: false,
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("registrarVehiculo", () => {
    it("debe registrar un vehículo correctamente cuando los datos son válidos", async () => {
      jest.mocked(repository.insertarVehiculo).mockResolvedValue(
        mockVehiculoValido,
      );

      const resultado = await registrarVehiculo(driverId, {
        patente: "AB123CD",
        marca: "Toyota",
        modelo: "Corolla",
        anio: 2022,
        tipoServicio: "AUTO",
      });

      expect(repository.insertarVehiculo).toHaveBeenCalledWith({
        driverId,
        patente: "AB123CD",
        marca: "Toyota",
        modelo: "Corolla",
        anio: 2022,
        tipoServicio: TipoServicio.AUTO,
        activo: false,
      });
      expect(resultado).toEqual(mockVehiculoValido);
    });

    it("debe propagar 409 si la patente ya existe en la BD", async () => {
      jest.mocked(repository.insertarVehiculo).mockRejectedValue(
        new AppError("Ya existe un vehículo con esa patente", 409),
      );

      await expect(
        registrarVehiculo(driverId, {
          patente: "AB123CD",
          anio: 2020,
          tipoServicio: "AUTO",
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("debe lanzar error si la patente no tiene formato válido", async () => {
      await expect(
        registrarVehiculo(driverId, {
          patente: "PATENTE_INVALIDA",
          anio: 2020,
          tipoServicio: "AUTO",
        }),
      ).rejects.toThrow(AppError);
      expect(repository.insertarVehiculo).not.toHaveBeenCalled();
    });

    it("debe lanzar error si el tipoServicio no es AUTO ni MOTO", async () => {
      await expect(
        registrarVehiculo(driverId, {
          patente: "AB123CD",
          anio: 2020,
          tipoServicio: "CAMIONETA",
        }),
      ).rejects.toThrow(AppError);
    });

    it("debe lanzar error si el año es menor a 1990", async () => {
      await expect(
        registrarVehiculo(driverId, {
          patente: "AB123CD",
          anio: 1980,
          tipoServicio: "AUTO",
        }),
      ).rejects.toThrow(AppError);
    });
  });

  describe("listarVehiculos", () => {
    it("debe retornar la lista de vehículos de un conductor", async () => {
      jest.mocked(repository.listarVehiculosPorConductor).mockResolvedValue([
        mockVehiculoValido,
      ]);

      const resultado = await listarVehiculos(driverId);

      expect(repository.listarVehiculosPorConductor).toHaveBeenCalledWith(
        driverId,
      );
      expect(resultado).toHaveLength(1);
      expect(resultado[0].patente).toBe("AB123CD");
    });
  });

  describe("obtenerVehiculo", () => {
    it("debe retornar el vehículo si pertenece al conductor", async () => {
      jest.mocked(repository.buscarVehiculoDeConductor).mockResolvedValue(
        mockVehiculoValido,
      );

      const resultado = await obtenerVehiculo(driverId, "veh-uuid-1");

      expect(repository.buscarVehiculoDeConductor).toHaveBeenCalledWith(
        driverId,
        "veh-uuid-1",
      );
      expect(resultado).toEqual(mockVehiculoValido);
    });

    it("debe lanzar 404 si el vehículo no existe para ese conductor", async () => {
      jest.mocked(repository.buscarVehiculoDeConductor).mockResolvedValue(
        null,
      );

      await expect(
        obtenerVehiculo(driverId, "veh-inexistente"),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("activarVehiculo", () => {
    it("debe activar el vehículo correctamente si existe", async () => {
      const mockVehiculoActivo = { ...mockVehiculoValido, activo: true };

      jest.mocked(repository.buscarVehiculoDeConductor).mockResolvedValue(
        mockVehiculoValido,
      );
      jest.mocked(repository.activarVehiculoEnBD).mockResolvedValue(
        mockVehiculoActivo,
      );

      const resultado = await activarVehiculo(driverId, "veh-uuid-1");

      expect(repository.activarVehiculoEnBD).toHaveBeenCalledWith(
        driverId,
        "veh-uuid-1",
      );
      expect(resultado.activo).toBe(true);
    });

    it("debe lanzar 404 al intentar activar un vehículo inexistente", async () => {
      jest.mocked(repository.buscarVehiculoDeConductor).mockResolvedValue(
        null,
      );

      await expect(
        activarVehiculo(driverId, "veh-inexistente"),
      ).rejects.toMatchObject({ status: 404 });
      expect(repository.activarVehiculoEnBD).not.toHaveBeenCalled();
    });
  });
});
