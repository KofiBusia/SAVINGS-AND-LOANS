import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { create } from 'xmlbuilder2';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from './audit-log.service';
import { AML_1044 } from '../../../../shared/src/constants/compliance';

export interface SuspiciousTransactionReport {
  transactionId: string;
  customerId: string;
  customerName: string;
  ghanaCardHash: string;
  transactionDate: Date;
  transactionAmount: number;
  transactionType: string;
  suspicionReason: string;
  reportedBy: string;
  additionalDetails?: string;
}

export interface CashTransactionReport {
  transactionId: string;
  customerId: string;
  customerName: string;
  ghanaCardHash: string;
  transactionDate: Date;
  cashAmount: number;
  transactionDirection: 'CREDIT' | 'DEBIT';
  branchCode: string;
  narrative?: string;
}

/**
 * FIC Reporting Service - AML Act 1044 Compliant
 *
 * Generates and submits:
 * - STR (Suspicious Transaction Reports) to Financial Intelligence Centre
 * - CTR (Cash Transaction Reports) for transactions >= GH₵10,000
 *
 * Reports are submitted in XML format per FIC/goAML schema.
 * 20-day deadline for STR submission after detection.
 */
@Injectable()
export class FicReportingService {
  private readonly logger = new Logger(FicReportingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Generate and submit a Suspicious Transaction Report (STR) to FIC.
   * Required by AML Act 1044 when suspicious activity is detected.
   */
  async submitSTR(report: SuspiciousTransactionReport, submittedBy: string): Promise<{ referenceId: string }> {
    const ficConfig = this.config.get('ghana.fic');

    const xml = this.buildSTRXml(report, ficConfig);

    let ficReferenceId: string;
    try {
      const response = await axios.post<{ referenceId: string }>(ficConfig.strSubmissionUrl, xml, {
        headers: {
          'Content-Type': 'application/xml',
          'Authorization': `Bearer ${ficConfig.apiKey}`,
          'X-Institution-Code': ficConfig.institutionCode,
        },
        timeout: 30_000,
      });
      ficReferenceId = response.data.referenceId;
    } catch (error) {
      this.logger.error('FIC STR submission failed', error);
      // Store as pending for retry
      await this.prisma.regulatoryReport.create({
        data: {
          type: 'STR',
          status: 'PENDING_RETRY',
          payload: report as unknown as Record<string, unknown>,
          xmlContent: xml,
          errorMessage: (error as Error).message,
        },
      });
      throw error;
    }

    // Store successful submission
    await this.prisma.regulatoryReport.create({
      data: {
        type: 'STR',
        status: 'SUBMITTED',
        externalReferenceId: ficReferenceId,
        payload: report as unknown as Record<string, unknown>,
        xmlContent: xml,
        submittedAt: new Date(),
      },
    });

    await this.auditLog.log({
      action: 'STR_SUBMITTED',
      userId: submittedBy,
      customerId: report.customerId,
      metadata: {
        ficReferenceId,
        transactionId: report.transactionId,
        amount: report.transactionAmount,
        suspicionReason: report.suspicionReason,
      },
    });

    this.logger.log(`STR submitted to FIC. Reference: ${ficReferenceId}`);
    return { referenceId: ficReferenceId };
  }

  /**
   * Generate and submit a Cash Transaction Report (CTR) to FIC.
   * Required for all cash transactions >= GH₵10,000 (AML Act 1044).
   */
  async submitCTR(report: CashTransactionReport, submittedBy: string): Promise<{ referenceId: string }> {
    if (report.cashAmount < AML_1044.CTR_THRESHOLD_GHS) {
      throw new Error(
        `CTR not required for amounts below GH₵${AML_1044.CTR_THRESHOLD_GHS}. Amount: GH₵${report.cashAmount}`,
      );
    }

    const ficConfig = this.config.get('ghana.fic');
    const xml = this.buildCTRXml(report, ficConfig);

    let ficReferenceId: string;
    try {
      const response = await axios.post<{ referenceId: string }>(ficConfig.ctrSubmissionUrl, xml, {
        headers: {
          'Content-Type': 'application/xml',
          'Authorization': `Bearer ${ficConfig.apiKey}`,
          'X-Institution-Code': ficConfig.institutionCode,
        },
        timeout: 30_000,
      });
      ficReferenceId = response.data.referenceId;
    } catch (error) {
      this.logger.error('FIC CTR submission failed', error);
      await this.prisma.regulatoryReport.create({
        data: {
          type: 'CTR',
          status: 'PENDING_RETRY',
          payload: report as unknown as Record<string, unknown>,
          xmlContent: xml,
          errorMessage: (error as Error).message,
        },
      });
      throw error;
    }

    await this.prisma.regulatoryReport.create({
      data: {
        type: 'CTR',
        status: 'SUBMITTED',
        externalReferenceId: ficReferenceId,
        payload: report as unknown as Record<string, unknown>,
        xmlContent: xml,
        submittedAt: new Date(),
      },
    });

    await this.auditLog.log({
      action: 'CTR_SUBMITTED',
      userId: submittedBy,
      customerId: report.customerId,
      metadata: { ficReferenceId, transactionId: report.transactionId, cashAmount: report.cashAmount },
    });

    return { referenceId: ficReferenceId };
  }

  private buildSTRXml(report: SuspiciousTransactionReport, ficConfig: { institutionCode: string; reportingName: string }): string {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('goAML', { xmlns: 'http://www.unodc.org/goaml/en/' })
        .ele('report')
          .ele('rentity_id').txt(ficConfig.institutionCode).up()
          .ele('rentity_branch').txt('HQ').up()
          .ele('submission_date').txt(new Date().toISOString().split('T')[0]).up()
          .ele('type_code').txt('STR').up()
          .ele('entity_reference').txt(report.transactionId).up()
          .ele('reason').txt(report.suspicionReason).up()
          .ele('action').txt('INVESTIGATED').up()
          .ele('transaction')
            .ele('transactionnumber').txt(report.transactionId).up()
            .ele('transaction_description').txt(report.transactionType).up()
            .ele('date_transaction').txt(report.transactionDate.toISOString().split('T')[0]).up()
            .ele('amount_local').txt(report.transactionAmount.toFixed(2)).up()
            .ele('currency_amount_local').txt('GHS').up()
            .ele('from_funds_code').txt('E').up()
          .up()
          .ele('subject')
            .ele('subject_name').txt(report.customerName).up()
            .ele('id_type').txt('NATIONAL_ID').up()
            .ele('id_number').txt('[ENCRYPTED_HASH]').up()
          .up()
        .up()
      .up();

    return doc.end({ prettyPrint: true });
  }

  private buildCTRXml(report: CashTransactionReport, ficConfig: { institutionCode: string; reportingName: string }): string {
    const doc = create({ version: '1.0', encoding: 'UTF-8' })
      .ele('goAML', { xmlns: 'http://www.unodc.org/goaml/en/' })
        .ele('report')
          .ele('rentity_id').txt(ficConfig.institutionCode).up()
          .ele('submission_date').txt(new Date().toISOString().split('T')[0]).up()
          .ele('type_code').txt('CTR').up()
          .ele('entity_reference').txt(report.transactionId).up()
          .ele('transaction')
            .ele('transactionnumber').txt(report.transactionId).up()
            .ele('date_transaction').txt(report.transactionDate.toISOString().split('T')[0]).up()
            .ele('amount_local').txt(report.cashAmount.toFixed(2)).up()
            .ele('currency_amount_local').txt('GHS').up()
            .ele('transaction_direction').txt(report.transactionDirection).up()
            .ele('branch_code').txt(report.branchCode).up()
          .up()
          .ele('subject')
            .ele('subject_name').txt(report.customerName).up()
            .ele('id_type').txt('NATIONAL_ID').up()
            .ele('id_number').txt('[ENCRYPTED_HASH]').up()
          .up()
        .up()
      .up();

    return doc.end({ prettyPrint: true });
  }
}
