import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(opts: {
    userId?: string | null;
    action: string;
    resource: string;
    detail?: Record<string, unknown>;
  }) {
    await this.prisma.client.auditLog.create({
      data: {
        userId: opts.userId || null,
        action: opts.action,
        resource: opts.resource,
        detail: opts.detail ? JSON.stringify(opts.detail) : null,
      },
    });
  }
}
