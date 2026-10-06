import { describe, it, expect, vi, beforeEach } from "vitest";
import { iniciarConsumerViajeCancelado } from "../../reintegro/consumerViajeCancelado";
import { ErrorPermanente } from "../../reintegro/obtenerCargo";
import * as procesarReintegroModule from "../../reintegro/procesarReintegro";
import { QUEUE_CANCELADO } from "../../infraestructura/rabbit";

describe("consumerViajeCancelado", () => {
  let mockChannel: any;
  let mockMsg: any;
  const evento = {
    viajeId: "v123",
    clienteId: "cliente-123",
    motivo: "cliente_solicita",
    evento: "cancelacion_cliente",
    timestamp: "2026-10-05T10:00:00Z",
  };

  beforeEach(() => {
    mockChannel = {
      consume: vi.fn(async (queue, callback) => {
        mockMsg = {
          content: Buffer.from(JSON.stringify(evento)),
          properties: { messageId: "msg-001", headers: {} },
        };
        await callback(mockMsg);
      }),
      ack: vi.fn(),
      nack: vi.fn(),
      sendToQueue: vi.fn(),
    };
    vi.clearAllMocks();
  });

  it("debería procesar un evento de viaje cancelado exitosamente", async () => {
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockResolvedValue(
      "procesado"
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(procesarReintegroModule.procesarReintegro).toHaveBeenCalledWith(evento);
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it("debería reintentar si el procesamiento lanza un error transitorio", async () => {
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockRejectedValue(
      new Error("cargo no responde")
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
      QUEUE_CANCELADO,
      mockMsg.content,
      expect.objectContaining({
        headers: expect.objectContaining({ "x-intentos": 1 }),
      })
    );
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it("debería descartar si el procesamiento lanza un error permanente", async () => {
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockRejectedValue(
      new ErrorPermanente("rechazado")
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.nack).toHaveBeenCalledWith(mockMsg, false, false);
  });

  it("debería descartar si la BD ya tiene la orden (duplicado)", async () => {
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockResolvedValue(
      "duplicado"
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(procesarReintegroModule.procesarReintegro).toHaveBeenCalledWith(evento);
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });

  it("debería reintentar si la BD falla", async () => {
    vi.spyOn(procesarReintegroModule, "procesarReintegro").mockRejectedValue(
      new Error("ECONNREFUSED")
    );

    await iniciarConsumerViajeCancelado(mockChannel);

    expect(mockChannel.sendToQueue).toHaveBeenCalled();
    expect(mockChannel.ack).toHaveBeenCalledWith(mockMsg);
  });
});