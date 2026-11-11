import { describe, expect, it, vi } from "vitest";

import { NotificationOutboxRelay } from "../../../src/messaging/notification-outbox-relay";

const envelope = {
  messageId: "b1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d",
  eventType: "NotificationRequested" as const,
  version: 1 as const,
  occurredAt: "2026-10-11T23:04:01.000Z",
  correlationId: "document-42",
  producer: "m8-notifications" as const,
  data: {
    notificationId: "c1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d",
    recipientId: 42,
    eventType: "DRIVER_DOCUMENT_REGISTERED" as const,
    channel: "PUSH" as const,
    message: "Tu documento fue registrado correctamente.",
    createdAt: "2026-10-11T23:04:01.000Z",
  },
};

function fixture(confirmError?: Error) {
  const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValue(client) };
  const outbox = {
    claimPendingForPublish: vi.fn().mockResolvedValue([envelope]),
    markPublishedWithClient: vi.fn().mockResolvedValue(true),
  };
  const channel = {
    publish: vi.fn((_exchange: string, _key: string, _content: Buffer, _options: unknown, callback: (error?: Error) => void) => {
      callback(confirmError);
      return true;
    }),
    waitForConfirms: vi.fn(),
  };
  const relay = new NotificationOutboxRelay(pool as any, outbox as any, channel as any);
  return { client, outbox, channel, relay };
}

describe("RF8.6 - relay NotificationRequested", () => {
  it("publica en mobility.events y marca el Outbox después del confirm", async () => {
    const { client, outbox, channel, relay } = fixture();

    expect(await relay.publishPending()).toBe(1);
    expect(channel.publish).toHaveBeenCalledWith(
      "mobility.events",
      "notification.requested",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, messageId: envelope.messageId }),
      expect.any(Function),
    );
    expect(JSON.parse(channel.publish.mock.calls[0][2].toString())).toEqual(envelope);
    expect(outbox.markPublishedWithClient).toHaveBeenCalledWith(client, envelope.messageId, expect.any(String));
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("conserva el Outbox pendiente si RabbitMQ rechaza la publicación", async () => {
    const { client, outbox, relay } = fixture(new Error("confirm NACK"));

    await expect(relay.publishPending()).rejects.toThrow("confirm NACK");
    expect(outbox.markPublishedWithClient).not.toHaveBeenCalled();
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
