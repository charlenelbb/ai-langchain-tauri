import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma.service';
import { MemoryService } from './memory.service';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { SseStreamService } from './sse/sse-stream.service';
import { CsController } from './cs/cs.controller';
import { CsService } from './cs/cs.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AuditService } from './auth/audit.service';

@Module({
  imports: [
    MulterModule.register({ storage: require('multer').memoryStorage() }),
  ],
  controllers: [AppController, RagController, CsController, AuthController],
  providers: [
    AppService,
    PrismaService,
    MemoryService,
    RagService,
    SseStreamService,
    CsService,
    AuthService,
    AuditService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
