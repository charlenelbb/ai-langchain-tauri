import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // 使用内存存储，这样上传的图片无需写入磁盘，可直接从 buffer 中读取
    MulterModule.register({ storage: require('multer').memoryStorage() }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
