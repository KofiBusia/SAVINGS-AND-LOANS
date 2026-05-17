/**
 * Credit Bureau Client
 *
 * Integrates with Ghana's licensed credit bureaus:
 *   - XDS Data Ghana (primary)
 *   - Dun & Bradstreet (D&B) Ghana (secondary)
 *   - MyCredit Score Ghana (tertiary / consumer-facing)
 *
 * Compliance:
 *   - Credit Reporting Act 2007 (Act 726)
 *   - Credit Reporting L.I. 2394 (2021) — mandatory reporting within 5 days of event
 *   - BoG Directive on Credit Reporting (2022)
 *   - Data Protection Act 2012 (Act 843) — consent required before inquiry
 *
 * All credit inquiries are logged; adverse action notices must be issued within
 * 30 days of application denial (ECOA-equivalent under Act 726 §14).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHmac, randomBytes } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { createObjectCsvStringifier } from 'csv-writer';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum CreditBureau {
  XDS = 'XDS',
  DNB = 'DNB',
  MYCREDIT = 'MYCREDIT',
}

export enum CreditEventType {
  LOAN_GRANTED = 'LOAN_GRANTED',
  LOAN_REPAYMENT = 'LOAN_REPAYMENT',
  LOAN_DEFAULT = 'LOAN_DEFAULT',
  LOAN_WRITEOFF = 'LOAN_WRITEOFF',
  LOAN_RESTRUCTURED = 'LOAN_RESTRUCTURED',
  LOAN_CLOSED = 'LOAN_CLOSED',
  INQUIRY = 'INQUIRY',
}

export enum CreditRiskGrade {
  A = 'A', // Excellent (750–850)
  B = 'B', // Good (650–749)
  C = 'C', // Fair (550–649)
  D = 'D', // Poor (400–549)
  E = 'E', // Very Poor (<400)
}

export enum AdverseActionReason {
  LOW_CREDIT_SCORE = 'LOW_CREDIT_SCORE',
  HIGH_EXISTING_DEBT = 'HIGH_EXISTING_DEBT',
  DEROGATORY_HISTORY = 'DEROGATORY_HISTORY',
  INSUFFICIENT_CREDIT_HISTORY = 'INSUFFICIENT_CREDIT_HISTORY',
  INCOME_INSUFFICIENT = 'INCOME_INSUFFICIENT',
  UNVERIFIABLE_INFORMATION = 'UNVERIFIABLE_INFORMATION',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CreditBureauConfig {
  xds: { baseUrl: string; apiKey: string; institutionId: string };
  dnb: { baseUrl: string; apiKey: string; subscriberId: string };
  mycredit: { baseUrl: string; apiKey: string; partnerId: string };
  useMock: boolean;
}

export interface CreditInquiryRequest {
  subjectType: 'INDIVIDUAL' | 'BUSINESS';
  ghanaCardNumber?: string; // GHA-XXXXXXXXX-X
  tinNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  phoneNumber?: string;
  businessName?: string;
  businessRegistrationNumber?: string;
  consentReference: string; // mandatory — references consent record
  requestingOfficerId: string;
  bureaus?: CreditBureau[];
}

export interface CreditAccount {
  accountNumber: string;
  creditorName: string;
  accountType: string;
  openDate: string;
  closeDate?: string;
  creditLimit?: number;
  currentBalance: number;
  overdueAmount: number;
  monthlyPayment?: number;
  paymentStatus: string;
  delinquencyHistory: number[]; // months overdue per payment
  lastUpdated: string;
}

export interface CreditInquiryResponse {
  bureau: CreditBureau;
  inquiryId: string;
  subjectName: string;
  creditScore: number; // 300–850
  riskGrade: CreditRiskGrade;
  totalAccounts: number;
  openAccounts: number;
  overdueAccounts: number;
  totalDebt: number; // GHS
  totalOverdueDebt: number; // GHS
  monthsSinceLastDelinquency?: number;
  totalInquiriesLast12Months: number;
  accounts: CreditAccount[];
  publicRecords: string[];
  remarks: string[];
  reportDate: string;
  nextUpdateDate: string;
  rawScore?: number;
  confidence: number; // 0–1
}

export interface CreditEvent {
  reportingInstitution: string;
  institutionCode: string;
  subjectGhanaCard: string;
  subjectName: string;
  accountReference: string;
  eventType: CreditEventType;
  eventDate: string; // YYYY-MM-DD
  loanAmount?: number; // GHS
  outstandingBalance?: number; // GHS
  overdueAmount?: number; // GHS
  overduedays?: number;
  currency: 'GHS';
  facilityType: string; // 'PERSONAL_LOAN' | 'SME_LOAN' | 'SAVINGS' etc.
}

export interface CreditEventSubmissionResult {
  bureau: CreditBureau;
  submitted: number;
  rejected: number;
  rejectionReasons: string[];
  batchReference: string;
  submittedAt: string;
}

export interface AdverseActionNotice {
  noticeId: string;
  applicantName: string;
  applicantAddress: string;
  applicationReference: string;
  applicationDate: string;
  decisionDate: string;
  decisionType: 'DENIED' | 'COUNTEROFFER' | 'INCREASED_RATE';
  reasons: AdverseActionReason[];
  creditBureauUsed: CreditBureau;
  bureauAddress: string;
  bureauPhone: string;
  disputeDeadline: string; // 60 days from notice
  legalCitation: string;
  generatedAt: string;
  htmlContent: string;
}

// ─── BoG CSV Format for Daily Batch Submission ────────────────────────────────

interface BoGCsvRecord {
  INSTITUTION_CODE: string;
  REPORT_DATE: string;
  SUBJECT_GHANA_CARD: string;
  SUBJECT_NAME: string;
  ACCOUNT_REFERENCE: string;
  EVENT_TYPE: string;
  EVENT_DATE: string;
  LOAN_AMOUNT: string;
  OUTSTANDING_BALANCE: string;
  OVERDUE_AMOUNT: string;
  OVERDUE_DAYS: string;
  CURRENCY: string;
  FACILITY_TYPE: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 15000;

@Injectable()
export class CreditBureauClient {
  private readonly logger = new Logger(CreditBureauClient.name);
  private readonly config: CreditBureauConfig;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.config = {
      xds: {
        baseUrl: this.configService.get('XDS_BASE_URL', 'https://api.xdsdata.com.gh/v2'),
        apiKey: this.configService.get('XDS_API_KEY', ''),
        institutionId: this.configService.get('XDS_INSTITUTION_ID', ''),
      },
      dnb: {
        baseUrl: this.configService.get('DNB_BASE_URL', 'https://api.dnb.com.gh/v1'),
        apiKey: this.configService.get('DNB_API_KEY', ''),
        subscriberId: this.configService.get('DNB_SUBSCRIBER_ID', ''),
      },
      mycredit: {
        baseUrl: this.configService.get('MYCREDIT_BASE_URL', 'https://api.mycreditscore.com.gh/v1'),
        apiKey: this.configService.get('MYCREDIT_API_KEY', ''),
        partnerId: this.configService.get('MYCREDIT_PARTNER_ID', ''),
      },
      useMock: this.configService.get('CREDIT_BUREAU_USE_MOCK', 'true') === 'true',
    };

    this.logger.log(`Credit Bureau Client initialised [mock=${this.config.useMock}]`);
  }

  // ─── Credit Inquiry ─────────────────────────────────────────────────────────

  /**
   * Perform a credit inquiry. Queries requested bureaus in parallel.
   * Consent must be obtained before calling this method (Act 726 §8).
   */
  async creditInquiry(
    request: CreditInquiryRequest,
  ): Promise<CreditInquiryResponse[]> {
    const bureaus = request.bureaus ?? [CreditBureau.XDS, CreditBureau.DNB];

    this.logger.log(
      `Credit inquiry [consent=${request.consentReference}, bureaus=${bureaus.join(',')}]`,
    );

    if (this.config.useMock) {
      return bureaus.map((b) => this.mockInquiryResponse(b, request));
    }

    const results = await Promise.allSettled(
      bureaus.map((bureau) => this.performInquiry(bureau, request)),
    );

    const responses: CreditInquiryResponse[] = [];
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        responses.push(result.value);
      } else {
        this.logger.error(
          `Credit inquiry failed [bureau=${bureaus[i]}]: ${result.reason?.message}`,
        );
        // Do NOT throw — partial results are acceptable; caller decides adequacy
      }
    }

    if (responses.length === 0) {
      throw new Error('All credit bureau inquiries failed — cannot proceed');
    }

    return responses;
  }

  /**
   * Submit a single credit event to all active bureaus.
   * Must be submitted within 5 days of event (L.I. 2394 regulation 12).
   */
  async submitCreditEvent(
    event: CreditEvent,
    bureaus: CreditBureau[] = [CreditBureau.XDS, CreditBureau.DNB],
  ): Promise<CreditEventSubmissionResult[]> {
    this.logger.log(
      `Submitting credit event [type=${event.eventType}, ref=${event.accountReference}]`,
    );

    if (this.config.useMock) {
      return bureaus.map((b) => this.mockSubmissionResult(b));
    }

    const results = await Promise.allSettled(
      bureaus.map((bureau) => this.submitEventToBureau(bureau, event)),
    );

    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : {
            bureau: bureaus[i],
            submitted: 0,
            rejected: 1,
            rejectionReasons: [r.reason?.message ?? 'Unknown error'],
            batchReference: `FAIL-${Date.now()}`,
            submittedAt: new Date().toISOString(),
          },
    );
  }

  /**
   * Generate BoG-prescribed CSV for daily batch submission.
   * Format complies with BoG Credit Reporting Circular CRC/2022/001.
   *
   * @param events - Credit events to include in the batch
   * @param reportDate - Report date (YYYY-MM-DD)
   * @param institutionCode - BoG-assigned institution code
   */
  async generateBoGBatchCsv(
    events: CreditEvent[],
    reportDate: string,
    institutionCode: string,
  ): Promise<string> {
    this.logger.log(
      `Generating BoG batch CSV [date=${reportDate}, records=${events.length}]`,
    );

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'INSTITUTION_CODE', title: 'INSTITUTION_CODE' },
        { id: 'REPORT_DATE', title: 'REPORT_DATE' },
        { id: 'SUBJECT_GHANA_CARD', title: 'SUBJECT_GHANA_CARD' },
        { id: 'SUBJECT_NAME', title: 'SUBJECT_NAME' },
        { id: 'ACCOUNT_REFERENCE', title: 'ACCOUNT_REFERENCE' },
        { id: 'EVENT_TYPE', title: 'EVENT_TYPE' },
        { id: 'EVENT_DATE', title: 'EVENT_DATE' },
        { id: 'LOAN_AMOUNT', title: 'LOAN_AMOUNT' },
        { id: 'OUTSTANDING_BALANCE', title: 'OUTSTANDING_BALANCE' },
        { id: 'OVERDUE_AMOUNT', title: 'OVERDUE_AMOUNT' },
        { id: 'OVERDUE_DAYS', title: 'OVERDUE_DAYS' },
        { id: 'CURRENCY', title: 'CURRENCY' },
        { id: 'FACILITY_TYPE', title: 'FACILITY_TYPE' },
      ],
    });

    const records: BoGCsvRecord[] = events.map((e) => ({
      INSTITUTION_CODE: institutionCode,
      REPORT_DATE: reportDate,
      SUBJECT_GHANA_CARD: e.subjectGhanaCard,
      SUBJECT_NAME: e.subjectName.toUpperCase(),
      ACCOUNT_REFERENCE: e.accountReference,
      EVENT_TYPE: e.eventType,
      EVENT_DATE: e.eventDate,
      LOAN_AMOUNT: e.loanAmount?.toFixed(2) ?? '0.00',
      OUTSTANDING_BALANCE: e.outstandingBalance?.toFixed(2) ?? '0.00',
      OVERDUE_AMOUNT: e.overdueAmount?.toFixed(2) ?? '0.00',
      OVERDUE_DAYS: e.overduedays?.toString() ?? '0',
      CURRENCY: 'GHS',
      FACILITY_TYPE: e.facilityType,
    }));

    const header = csvStringifier.getHeaderString();
    const rows = csvStringifier.stringifyRecords(records);
    return `${header}${rows}`;
  }

  /**
   * Parse credit score from bureau response and derive risk grade.
   */
  parseCreditScore(rawScore: number): { score: number; grade: CreditRiskGrade; description: string } {
    const score = Math.max(300, Math.min(850, rawScore));
    let grade: CreditRiskGrade;
    let description: string;

    if (score >= 750) {
      grade = CreditRiskGrade.A;
      description = 'Excellent credit history — low risk';
    } else if (score >= 650) {
      grade = CreditRiskGrade.B;
      description = 'Good credit history — acceptable risk';
    } else if (score >= 550) {
      grade = CreditRiskGrade.C;
      description = 'Fair credit history — moderate risk — enhanced monitoring required';
    } else if (score >= 400) {
      grade = CreditRiskGrade.D;
      description = 'Poor credit history — high risk — requires collateral';
    } else {
      grade = CreditRiskGrade.E;
      description = 'Very poor credit history — decline recommended';
    }

    return { score, grade, description };
  }

  /**
   * Generate an Adverse Action Notice per Act 726 §14.
   * Must be delivered within 30 days of the application decision.
   */
  generateAdverseActionNotice(params: {
    applicantName: string;
    applicantAddress: string;
    applicationReference: string;
    applicationDate: string;
    reasons: AdverseActionReason[];
    bureau: CreditBureau;
    decisionType: 'DENIED' | 'COUNTEROFFER' | 'INCREASED_RATE';
  }): AdverseActionNotice {
    const bureauContacts: Record<CreditBureau, { address: string; phone: string }> = {
      [CreditBureau.XDS]: {
        address: 'XDS Data Ghana Ltd, 2nd Floor, Valco Trust House, Accra',
        phone: '+233 302 123 456',
      },
      [CreditBureau.DNB]: {
        address: 'D&B Ghana, Ridge Tower, Accra',
        phone: '+233 302 789 012',
      },
      [CreditBureau.MYCREDIT]: {
        address: 'MyCredit Score, Airport City, Accra',
        phone: '+233 302 345 678',
      },
    };

    const today = new Date();
    const disputeDeadline = new Date(today);
    disputeDeadline.setDate(disputeDeadline.getDate() + 60);

    const reasonDescriptions: Record<AdverseActionReason, string> = {
      [AdverseActionReason.LOW_CREDIT_SCORE]: 'Credit score below minimum threshold',
      [AdverseActionReason.HIGH_EXISTING_DEBT]: 'Existing debt obligations exceed acceptable limits',
      [AdverseActionReason.DEROGATORY_HISTORY]: 'Derogatory payment history on record',
      [AdverseActionReason.INSUFFICIENT_CREDIT_HISTORY]: 'Insufficient credit history to assess risk',
      [AdverseActionReason.INCOME_INSUFFICIENT]: 'Income insufficient relative to requested amount',
      [AdverseActionReason.UNVERIFIABLE_INFORMATION]: 'Unable to verify submitted information',
    };

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Adverse Action Notice</title></head>
<body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
  <h2>NOTICE OF ADVERSE ACTION</h2>
  <p>Date: ${today.toISOString().substring(0, 10)}</p>
  <p>Dear ${params.applicantName},</p>
  <p>We regret to inform you that your loan application (Reference: ${params.applicationReference},
  dated ${params.applicationDate}) has resulted in the following decision:
  <strong>${params.decisionType.replace('_', ' ')}</strong>.</p>

  <h3>Reasons for this decision:</h3>
  <ul>
    ${params.reasons.map((r) => `<li>${reasonDescriptions[r]}</li>`).join('\n    ')}
  </ul>

  <p>This decision was based in whole or in part on information obtained from:</p>
  <p><strong>${params.bureau}</strong><br/>
  ${bureauContacts[params.bureau].address}<br/>
  Tel: ${bureauContacts[params.bureau].phone}</p>

  <p>You have the right to obtain a free copy of your credit report from the bureau
  within 60 days of this notice (by ${disputeDeadline.toISOString().substring(0, 10)}).
  You also have the right to dispute any inaccurate information.</p>

  <p>This notice is issued in compliance with the Credit Reporting Act 2007 (Act 726),
  Section 14 — Adverse Action Notice Requirements.</p>

  <p>Sincerely,<br/>Ghana Savings &amp; Loans Ltd<br/>Credit Risk Department</p>
</body>
</html>`;

    return {
      noticeId: `AAN-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`,
      applicantName: params.applicantName,
      applicantAddress: params.applicantAddress,
      applicationReference: params.applicationReference,
      applicationDate: params.applicationDate,
      decisionDate: today.toISOString().substring(0, 10),
      decisionType: params.decisionType,
      reasons: params.reasons,
      creditBureauUsed: params.bureau,
      bureauAddress: bureauContacts[params.bureau].address,
      bureauPhone: bureauContacts[params.bureau].phone,
      disputeDeadline: disputeDeadline.toISOString().substring(0, 10),
      legalCitation: 'Credit Reporting Act 2007 (Act 726), Section 14',
      generatedAt: new Date().toISOString(),
      htmlContent,
    };
  }

  // ─── Private Bureau-Specific Calls ──────────────────────────────────────────

  private async performInquiry(
    bureau: CreditBureau,
    request: CreditInquiryRequest,
  ): Promise<CreditInquiryResponse> {
    switch (bureau) {
      case CreditBureau.XDS:
        return this.xdsInquiry(request);
      case CreditBureau.DNB:
        return this.dnbInquiry(request);
      case CreditBureau.MYCREDIT:
        return this.myCreditInquiry(request);
    }
  }

  private async xdsInquiry(request: CreditInquiryRequest): Promise<CreditInquiryResponse> {
    const body = {
      institutionId: this.config.xds.institutionId,
      consentRef: request.consentReference,
      ghanaCardNumber: request.ghanaCardNumber,
      tin: request.tinNumber,
      firstName: request.firstName,
      lastName: request.lastName,
      dob: request.dateOfBirth,
    };

    const response = await firstValueFrom(
      this.httpService
        .post(`${this.config.xds.baseUrl}/inquiry`, body, {
          headers: { 'X-API-Key': this.config.xds.apiKey, 'Content-Type': 'application/json' },
        })
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return this.mapXdsResponse(response.data);
  }

  private async dnbInquiry(request: CreditInquiryRequest): Promise<CreditInquiryResponse> {
    const response = await firstValueFrom(
      this.httpService
        .post(
          `${this.config.dnb.baseUrl}/credit-reports`,
          {
            subscriberId: this.config.dnb.subscriberId,
            subjectId: request.ghanaCardNumber ?? request.tinNumber,
            subjectType: request.subjectType,
            consentRef: request.consentReference,
          },
          { headers: { Authorization: `Bearer ${this.config.dnb.apiKey}` } },
        )
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return this.mapDnbResponse(response.data);
  }

  private async myCreditInquiry(request: CreditInquiryRequest): Promise<CreditInquiryResponse> {
    const response = await firstValueFrom(
      this.httpService
        .get(`${this.config.mycredit.baseUrl}/scores/${request.ghanaCardNumber}`, {
          params: { partnerId: this.config.mycredit.partnerId, consent: request.consentReference },
          headers: { 'X-Partner-Key': this.config.mycredit.apiKey },
        })
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return this.mapMyCreditResponse(response.data);
  }

  private async submitEventToBureau(
    bureau: CreditBureau,
    event: CreditEvent,
  ): Promise<CreditEventSubmissionResult> {
    const urls: Record<CreditBureau, string> = {
      [CreditBureau.XDS]: `${this.config.xds.baseUrl}/events`,
      [CreditBureau.DNB]: `${this.config.dnb.baseUrl}/credit-events`,
      [CreditBureau.MYCREDIT]: `${this.config.mycredit.baseUrl}/events`,
    };

    const headers = this.buildHeaders(bureau);
    const response = await firstValueFrom(
      this.httpService
        .post(urls[bureau], event, { headers })
        .pipe(timeout(REQUEST_TIMEOUT_MS), catchError((e) => { throw e; })),
    );

    return {
      bureau,
      submitted: 1,
      rejected: 0,
      rejectionReasons: [],
      batchReference: response.data.batchReference ?? `BATCH-${Date.now()}`,
      submittedAt: new Date().toISOString(),
    };
  }

  private buildHeaders(bureau: CreditBureau): Record<string, string> {
    switch (bureau) {
      case CreditBureau.XDS:
        return { 'X-API-Key': this.config.xds.apiKey, 'Content-Type': 'application/json' };
      case CreditBureau.DNB:
        return { Authorization: `Bearer ${this.config.dnb.apiKey}`, 'Content-Type': 'application/json' };
      case CreditBureau.MYCREDIT:
        return { 'X-Partner-Key': this.config.mycredit.apiKey, 'Content-Type': 'application/json' };
    }
  }

  // ─── Response Mappers ────────────────────────────────────────────────────────

  private mapXdsResponse(data: Record<string, unknown>): CreditInquiryResponse {
    const rawScore = data.creditScore as number ?? 500;
    const { grade } = this.parseCreditScore(rawScore);
    return {
      bureau: CreditBureau.XDS,
      inquiryId: data.inquiryId as string,
      subjectName: data.fullName as string ?? '',
      creditScore: rawScore,
      riskGrade: grade,
      totalAccounts: data.totalAccounts as number ?? 0,
      openAccounts: data.openAccounts as number ?? 0,
      overdueAccounts: data.overdueAccounts as number ?? 0,
      totalDebt: data.totalDebt as number ?? 0,
      totalOverdueDebt: data.totalOverdueDebt as number ?? 0,
      monthsSinceLastDelinquency: data.monthsSinceLastDelinquency as number,
      totalInquiriesLast12Months: data.inquiriesLast12Months as number ?? 0,
      accounts: (data.accounts as CreditAccount[]) ?? [],
      publicRecords: (data.publicRecords as string[]) ?? [],
      remarks: (data.remarks as string[]) ?? [],
      reportDate: data.reportDate as string ?? new Date().toISOString(),
      nextUpdateDate: data.nextUpdateDate as string ?? '',
      rawScore,
      confidence: 0.95,
    };
  }

  private mapDnbResponse(data: Record<string, unknown>): CreditInquiryResponse {
    const rawScore = data.score as number ?? 500;
    const { grade } = this.parseCreditScore(rawScore);
    return {
      bureau: CreditBureau.DNB,
      inquiryId: data.reportId as string,
      subjectName: data.entityName as string ?? '',
      creditScore: rawScore,
      riskGrade: grade,
      totalAccounts: data.tradeLineCount as number ?? 0,
      openAccounts: data.openTradeLines as number ?? 0,
      overdueAccounts: data.delinquentTradeLines as number ?? 0,
      totalDebt: data.totalExposure as number ?? 0,
      totalOverdueDebt: data.delinquentAmount as number ?? 0,
      totalInquiriesLast12Months: data.inquiryCount as number ?? 0,
      accounts: (data.tradeLines as CreditAccount[]) ?? [],
      publicRecords: (data.publicRecords as string[]) ?? [],
      remarks: (data.comments as string[]) ?? [],
      reportDate: data.generatedDate as string ?? new Date().toISOString(),
      nextUpdateDate: '',
      rawScore,
      confidence: 0.9,
    };
  }

  private mapMyCreditResponse(data: Record<string, unknown>): CreditInquiryResponse {
    const rawScore = data.creditScore as number ?? 500;
    const { grade } = this.parseCreditScore(rawScore);
    return {
      bureau: CreditBureau.MYCREDIT,
      inquiryId: data.id as string,
      subjectName: data.name as string ?? '',
      creditScore: rawScore,
      riskGrade: grade,
      totalAccounts: 0,
      openAccounts: 0,
      overdueAccounts: 0,
      totalDebt: 0,
      totalOverdueDebt: 0,
      totalInquiriesLast12Months: 0,
      accounts: [],
      publicRecords: [],
      remarks: [(data.summary as string) ?? ''],
      reportDate: data.asOf as string ?? new Date().toISOString(),
      nextUpdateDate: '',
      rawScore,
      confidence: 0.75,
    };
  }

  // ─── Mock Implementations ────────────────────────────────────────────────────

  private mockInquiryResponse(
    bureau: CreditBureau,
    request: CreditInquiryRequest,
  ): CreditInquiryResponse {
    // Deterministic score from Ghana Card number for repeatable tests
    const seed = request.ghanaCardNumber?.replace(/\D/g, '').slice(-4) ?? '0600';
    const rawScore = 300 + (parseInt(seed, 10) % 550);
    const { grade } = this.parseCreditScore(rawScore);

    return {
      bureau,
      inquiryId: `MOCK-INQ-${Date.now()}-${bureau}`,
      subjectName: `${request.firstName ?? 'KOFI'} ${request.lastName ?? 'MENSAH'}`.toUpperCase(),
      creditScore: rawScore,
      riskGrade: grade,
      totalAccounts: 3,
      openAccounts: 2,
      overdueAccounts: rawScore < 500 ? 1 : 0,
      totalDebt: 5000,
      totalOverdueDebt: rawScore < 500 ? 800 : 0,
      monthsSinceLastDelinquency: rawScore < 500 ? 4 : undefined,
      totalInquiriesLast12Months: 2,
      accounts: [
        {
          accountNumber: 'ACC-MOCK-001',
          creditorName: 'Ghana Commercial Bank',
          accountType: 'PERSONAL_LOAN',
          openDate: '2022-03-01',
          creditLimit: 10000,
          currentBalance: 4500,
          overdueAmount: 0,
          monthlyPayment: 500,
          paymentStatus: 'CURRENT',
          delinquencyHistory: [0, 0, 0, 0, 0, 0],
          lastUpdated: new Date().toISOString().substring(0, 10),
        },
      ],
      publicRecords: [],
      remarks: [`Mock credit report for testing — bureau: ${bureau}`],
      reportDate: new Date().toISOString(),
      nextUpdateDate: new Date(Date.now() + 30 * 86400000).toISOString().substring(0, 10),
      rawScore,
      confidence: 1.0,
    };
  }

  private mockSubmissionResult(bureau: CreditBureau): CreditEventSubmissionResult {
    return {
      bureau,
      submitted: 1,
      rejected: 0,
      rejectionReasons: [],
      batchReference: `MOCK-BATCH-${Date.now()}`,
      submittedAt: new Date().toISOString(),
    };
  }
}
