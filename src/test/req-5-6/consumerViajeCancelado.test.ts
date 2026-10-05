import { describe, it, expect, vi, beforeEach } from "vitest";
import { iniciarConsumerViajeCancelado } from "../../reintegro/consumerViajeCancelado";
import * as obtenerCargoModule from "../../reintegro/obtenerCargo";
import * as procesarReintegroModule from "../../reintegro/procesarReintegro";
import * as reintegroBDModule from "../../reintegro/reintegroBD";
import * as rabbitModule from "../../infraestructura/rabbit";

describe("consumerViajeCancelado", () => {
  let mockChannel: any;
  let mockMsg: any;

  beforeEach(() => {
    mockChannel = {
      consume: vi.fn(async (queue, callback) => {
        mockMsg = {
          content: Buffer.from(
            JSON.stringify({
              idViaje: "v123",
              razon: "cliente_solicita",
              timestamp: "2026-10-05T10:00:00Z",
            })
          ),
          properties: {
            messageId: "msg-001",
          },
        };
        await callback(mockMsg);
      }),
      ack: vi.fn(),
      nack: vi.fn(),
    };
    vi.clearAllMocks();
  });

  it("debería procesar un evento de viaje cancelado exitosamente", async () => {
    vi.spyOn(obtenerCargoModule, "obtenerCargo").mockResolvedValue(1000 as any);
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockResolvedValue(950 as any);
    vi.spyOn(reintegroBDModule, "insertarReintegro").mockResolvedValue(true as any);
    vi.spyOn(rabbitModule, "publicar").mockImplementation(() => {});

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(obtenerCargoModule.obtenerCargo).toHaveBeenCalled();
    expect(procesarReintegroModule.procesarReintegro).toHaveBeenCalled();
    expect(reintegroBDModule.insertarReintegro).toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it("debería reintentar si obtenerCargo lanza ErrorTransitorio", async () => {
    class ErrorTransitorio extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ErrorTransitorio";
      }
    }

    vi.spyOn(obtenerCargoModule, "obtenerCargo").mockRejectedValue(
      new ErrorTransitorio("cargo no responde")
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, true);
    expect(reintegroBDModule.insertarReintegro).not.toHaveBeenCalled();
  });

  it("debería descartar si obtenerCargo lanza ErrorPermanente", async () => {
    class ErrorPermanente extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ErrorPermanente";
      }
    }

    vi.spyOn(obtenerCargoModule, "obtenerCargo").mockRejectedValue(
      new ErrorPermanente("rechazado")
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
    expect(reintegroBDModule.insertarReintegro).not.toHaveBeenCalled();
  });

  it("debería descartar si la BD ya tiene la orden (duplicado)", async () => {
    vi.spyOn(obtenerCargoModule, "obtenerCargo").mockResolvedValue(1000 as any);
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockResolvedValue(950 as any);
    vi.spyOn(reintegroBDModule, "insertarReintegro").mockRejectedValue(
      new Error('duplicate key "id_orden"')
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it("debería reintentar si la BD falla", async () => {
    vi.spyOn(obtenerCargoModule, "obtenerCargo").mockResolvedValue(1000 as any);
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockResolvedValue(950 as any);
    vi.spyOn(reintegroBDModule, "insertarReintegro").mockRejectedValue(
      new Error("ECONNREFUSED")
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, true);
  });
});