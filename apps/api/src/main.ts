import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: (process.env.FRONTEND_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim()),
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch(() => {
  console.error(
    'PaServe API failed to start. Check the backend configuration.',
  );
  process.exitCode = 1;
});
