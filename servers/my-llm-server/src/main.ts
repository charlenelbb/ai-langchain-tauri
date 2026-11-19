import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { parseCorsOrigin } from './http/cors-origin';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origin = parseCorsOrigin(process.env.CORS_ORIGIN);
  if (origin === true) {
    app.enableCors();
  } else {
    app.enableCors({ origin });
  }
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
