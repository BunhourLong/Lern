import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { parseEnv } from './config';

async function bootstrap(): Promise<void> {
  const config = parseEnv(process.env);
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(config.PORT);
}

void bootstrap();
