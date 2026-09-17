import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { hashPassword, readBearer, signToken, verifyPassword, verifyToken } from './token';
import type { AuthUser } from './auth.types';
import { isUserRole } from './auth.types';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('AuthService');

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureDemoUsers();
  }

  private async ensureDemoUsers() {
    const defaults: Array<{ username: string; role: 'customer' | 'agent' }> = [
      { username: 'customer', role: 'customer' },
      { username: 'agent', role: 'agent' },
    ];
    for (const item of defaults) {
      const existing = await this.prisma.client.user.findUnique({
        where: { username: item.username },
      });
      if (existing) continue;
      await this.prisma.client.user.create({
        data: {
          username: item.username,
          role: item.role,
          passwordHash: hashPassword('demo123'),
        },
      });
      this.logger.log(`已创建演示账号 ${item.username} / demo123`);
    }
  }

  async login(username: string, password: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { username: username.trim() },
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!isUserRole(user.role)) {
      throw new UnauthorizedException('账号角色无效');
    }
    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return {
      token,
      user: { id: user.id, username: user.username, role: user.role as AuthUser['role'] },
    };
  }

  userFromRequest(req: Request): AuthUser | null {
    const token = readBearer(req.headers.authorization);
    if (!token) return null;
    const payload = verifyToken(token);
    if (!payload || !isUserRole(payload.role)) return null;
    return { id: payload.sub, username: payload.username, role: payload.role };
  }
}
