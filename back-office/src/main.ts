import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Security headers - Cybersecurity Act 1038
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );

  // CORS - restrict to Ghana-hosted domains only (Data Protection Act 843)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',');
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-MFA-Token', 'X-Device-Id'],
    credentials: true,
  });

  // API versioning
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.setGlobalPrefix('api');

  // Request validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Swagger documentation (internal only - not exposed in production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Ghana Savings & Loans API')
      .setDescription('BoG-regulated savings and loan platform API. All endpoints require MFA for write operations.')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication and MFA')
      .addTag('customers', 'Customer KYC and account management')
      .addTag('loans', 'Loan origination and management')
      .addTag('savings', 'Savings accounts')
      .addTag('compliance', 'Regulatory compliance and reporting')
      .addTag('admin', 'Administrative functions')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.APP_PORT ?? 3001;
  await app.listen(port);
  console.log(`Ghana Savings & Loans API running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Data Region: ${process.env.GHANA_DATA_REGION} (Data Protection Act 843)`);
}

bootstrap();
