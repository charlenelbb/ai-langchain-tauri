import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | undefined;

export function getPrismaInstance(): PrismaClient {
  if (!prismaInstance) {
    console.log('Creating new PrismaClient instance');
    prismaInstance = new PrismaClient();
  }
  return prismaInstance;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrismaService');

  get client(): PrismaClient {
    return getPrismaInstance();
  }

  get session() {
    return getPrismaInstance().session;
  }

  get message() {
    return getPrismaInstance().message;
  }

  get $queryRaw() {
    return getPrismaInstance().$queryRaw;
  }

  get $executeRaw() {
    return getPrismaInstance().$executeRaw;
  }

  get $transaction() {
    return getPrismaInstance().$transaction;
  }

  async $disconnect() {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
      prismaInstance = undefined;
    }
  }

  async onModuleInit() {
    try {
      this.logger.log('✓ Prisma Service initialized');
      const client = getPrismaInstance();
      await client.$connect();
      this.logger.log('✓ Prisma connected successfully');
    } catch (error) {
      this.logger.error(
        '✗ Failed to connect to Prisma',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: any) {
    const client = getPrismaInstance();
    if (client) {
      client.$on('beforeExit' as never, async () => {
        await app.close();
      });
    }
  }
}
