import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import ghanaConfig from './config/ghana.config';
import { PrismaService } from './database/prisma.service';
import { AuditLogService } from './modules/compliance/audit-log.service';
import { KycAmlService } from './modules/compliance/kyc-aml.service';
import { FicReportingService } from './modules/compliance/fic-reporting.service';
import { DpcComplianceService } from './modules/compliance/dpc-compliance.service';
import { InterestCalculatorService } from './modules/loans/interest-calculator.service';
import { GhipssMmiClient } from './modules/integrations/ghipss-mmi.client';
import { MfaService } from './modules/auth/mfa.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [ghanaConfig] }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    AuditLogService,
    KycAmlService,
    FicReportingService,
    DpcComplianceService,
    InterestCalculatorService,
    GhipssMmiClient,
    MfaService,
  ],
})
export class AppModule {}
