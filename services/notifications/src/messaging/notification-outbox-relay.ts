import type { Pool } from "pg";
import { publishWithConfirm } from "@m8/shared";

import type { Rf81Application } from "../notifications/rf81-application";

type ConfirmChannel = Parameters<typeof publishWithConfirm>[0];

/** RF8.6 publica el Outbox de RF8.1 con el mismo messageId hasta recibir confirmación. */
export class NotificationOutboxRelay {
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private lastPollSuccessful = false;

  constructor(
    private readonly pool: Pool,
    private readonly outbox: Rf81Application["outbox"],
    private readonly channel: ConfirmChannel,
    private readonly pollIntervalMs = 1000,
  ) {}

  async publishPending(): Promise<number> {
    const client = await this.pool.connect().catch((error: unknown) => {
      this.lastPollSuccessful = false;
      throw error;
    });
    try {
      await client.query("BEGIN");
      const pending = await this.outbox.claimPendingForPublish(client, 25);
      for (const envelope of pending) {
        await publishWithConfirm(
          this.channel,
          "mobility.events",
          "notification.requested",
          Buffer.from(JSON.stringify(envelope)),
          { persistent: true, contentType: "application/json", messageId: envelope.messageId },
        );
        const marked = await this.outbox.markPublishedWithClient(client, envelope.messageId, new Date().toISOString());
        if (!marked) throw new Error(`No se pudo marcar el Outbox ${envelope.messageId} como publicado.`);
      }
      await client.query("COMMIT");
      this.lastPollSuccessful = true;
      return pending.length;
    } catch (error) {
      this.lastPollSuccessful = false;
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.lastPollSuccessful = false;
    const poll = async (): Promise<void> => {
      if (this.stopped) return;
      try {
        await this.publishPending();
      } catch (error) {
        console.warn("[RF8.6] Outbox NotificationRequested pendiente de reintento.", error);
      } finally {
        if (!this.stopped) this.timer = setTimeout(() => void poll(), this.pollIntervalMs);
      }
    };
    void poll();
  }

  stop(): void {
    this.stopped = true;
    this.lastPollSuccessful = false;
    if (this.timer) clearTimeout(this.timer);
  }

  isReady(): boolean {
    return !this.stopped && this.lastPollSuccessful;
  }
}
