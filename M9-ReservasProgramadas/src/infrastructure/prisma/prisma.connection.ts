import { PrismaClient } from '@prisma/client';

export class PrismaConnection {
  public readonly client: PrismaClient;

  public constructor(databaseUrl?: string) {
    this.client = new PrismaClient(
      databaseUrl === undefined ? undefined : { datasources: { db: { url: databaseUrl } } },
    );
  }

  public async connect(): Promise<void> {
    await this.client.$connect();
  }

  public async ping(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
