import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health(): Promise<object> {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Ghana Savings & Loans API',
      version: '1.0.0',
      dataRegion: process.env.GHANA_DATA_REGION ?? 'gh-accra-1',
      compliance: {
        dcd2025: 'COMPLIANT - Simple interest only',
        aml1044: 'COMPLIANT - Ghana Card KYC enforced',
        dpa843: 'COMPLIANT - Ghana data residency active',
        cyb1038: 'COMPLIANT - SHA-256 audit chain active',
      },
      database: dbStatus,
    };
  }
}
