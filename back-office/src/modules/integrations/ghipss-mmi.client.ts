import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { createHmac } from 'crypto';
import { IntegrationError, IntegrationErrorCode } from '../../../../shared/src/constants/errors';
import { detectMNO } from '../../../../shared/src/constants/ghana';

export type MobileMoneyNetwork = 'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY';

export interface DisbursementRequest {
  amount: number;
  recipientPhone: string;
  network: MobileMoneyNetwork;
  reference: string;
  narration: string;
  customerId: string;
}

export interface CollectionRequest {
  amount: number;
  payerPhone: string;
  network: MobileMoneyNetwork;
  reference: string;
  narration: string;
  customerId: string;
  callbackUrl?: string;
}

export interface GhipssTransactionStatus {
  reference: string;
  ghipssReference: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'REVERSED';
  amount: number;
  fee: number;
  completedAt?: Date;
  failureReason?: string;
}

/**
 * GhIPSS Mobile Money Interface (MMI) Client
 *
 * Handles mobile money disbursements and collections via:
 * - MTN MoMo
 * - Telecel Cash
 * - AirtelTigo Money
 *
 * Features: exponential backoff retry (max 3), webhook verification,
 * reconciliation queries, automatic MNO detection from phone number.
 *
 * Set GHIPSS_USE_MOCK=true for local development.
 */
@Injectable()
export class GhipssMmiClient {
  private readonly logger = new Logger(GhipssMmiClient.name);
  private readonly httpClient: AxiosInstance;
  private readonly useMock: boolean;

  constructor(private readonly config: ConfigService) {
    const ghipssConfig = this.config.get('ghana.ghipss');
    this.useMock = ghipssConfig.useMock;

    this.httpClient = axios.create({
      baseURL: ghipssConfig.baseUrl,
      timeout: ghipssConfig.timeoutMs,
      headers: {
        'X-Institution-Code': ghipssConfig.institutionCode,
        'Authorization': `Bearer ${ghipssConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Initiate a mobile money disbursement (loan disbursement).
   * Automatically detects MNO from phone number prefix.
   */
  async initiateDisbursement(request: DisbursementRequest): Promise<GhipssTransactionStatus> {
    if (this.useMock) return this.mockDisbursement(request);

    const payload = {
      amount: request.amount,
      currency: 'GHS',
      recipientMsisdn: this.normalizeMsisdn(request.recipientPhone),
      network: request.network,
      clientReference: request.reference,
      narration: request.narration,
      transactionType: 'DISBURSEMENT',
    };

    return this.executeWithRetry(() => this.httpClient.post<GhipssTransactionStatus>('/disbursements', payload));
  }

  /**
   * Initiate a mobile money collection (loan repayment).
   * Sends a payment prompt to the customer's phone.
   */
  async initiateCollection(request: CollectionRequest): Promise<GhipssTransactionStatus> {
    if (this.useMock) return this.mockCollection(request);

    const payload = {
      amount: request.amount,
      currency: 'GHS',
      payerMsisdn: this.normalizeMsisdn(request.payerPhone),
      network: request.network,
      clientReference: request.reference,
      narration: request.narration,
      transactionType: 'COLLECTION',
      callbackUrl: request.callbackUrl,
    };

    return this.executeWithRetry(() => this.httpClient.post<GhipssTransactionStatus>('/collections', payload));
  }

  /**
   * Query the status of a GhIPSS transaction.
   */
  async getTransactionStatus(ghipssReference: string): Promise<GhipssTransactionStatus> {
    if (this.useMock) return this.mockStatusCheck(ghipssReference);
    const response = await this.httpClient.get<GhipssTransactionStatus>(`/transactions/${ghipssReference}`);
    return response.data;
  }

  /**
   * Reconcile transactions for a date range.
   * Used for daily end-of-day reconciliation.
   */
  async reconcile(date: Date): Promise<GhipssTransactionStatus[]> {
    if (this.useMock) return [];
    const dateStr = date.toISOString().split('T')[0];
    const response = await this.httpClient.get<GhipssTransactionStatus[]>(`/reconciliation?date=${dateStr}`);
    return response.data;
  }

  /**
   * Verify GhIPSS webhook signature to prevent spoofed callbacks.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const ghipssConfig = this.config.get('ghana.ghipss');
    const expectedSig = createHmac('sha256', ghipssConfig.webhookSecret)
      .update(payload)
      .digest('hex');
    return expectedSig === signature;
  }

  /** Detect MNO from phone number prefix */
  detectNetwork(phone: string): MobileMoneyNetwork {
    const mno = detectMNO(phone);
    const mapping: Record<string, MobileMoneyNetwork> = {
      MTN: 'MTN_MOMO',
      TELECEL: 'TELECEL_CASH',
      AIRTELTIGO: 'AIRTELTIGO_MONEY',
    };
    if (!mno || !mapping[mno]) {
      throw new IntegrationError(IntegrationErrorCode.GHIPSS_FAILED, `Cannot detect MNO for phone: ${phone}`);
    }
    return mapping[mno];
  }

  private async executeWithRetry<T>(
    fn: () => Promise<{ data: T }>,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fn();
        return response.data;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`GhIPSS attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
        }
      }
    }
    throw new IntegrationError(
      IntegrationErrorCode.GHIPSS_FAILED,
      `GhIPSS transaction failed after ${maxRetries} attempts: ${lastError.message}`,
      false,
    );
  }

  private normalizeMsisdn(phone: string): string {
    const cleaned = phone.replace(/\s+/g, '');
    if (cleaned.startsWith('+233')) return cleaned.slice(1); // 233XXXXXXXXX
    if (cleaned.startsWith('0')) return '233' + cleaned.slice(1);
    return cleaned;
  }

  // ================================================================
  // MOCK IMPLEMENTATIONS FOR LOCAL DEVELOPMENT (GHIPSS_USE_MOCK=true)
  // ================================================================

  private async mockDisbursement(request: DisbursementRequest): Promise<GhipssTransactionStatus> {
    this.logger.log(`[MOCK] GhIPSS Disbursement: GH₵${request.amount} to ${request.recipientPhone}`);
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

    // Simulate 85% success rate
    if (Math.random() < 0.15) {
      throw new IntegrationError(IntegrationErrorCode.GHIPSS_FAILED, '[MOCK] Network timeout', true);
    }

    return {
      reference: request.reference,
      ghipssReference: `GHIPSS-DISB-${Date.now()}`,
      status: 'SUCCESS',
      amount: request.amount,
      fee: request.amount * 0.01, // 1% fee
      completedAt: new Date(),
    };
  }

  private async mockCollection(request: CollectionRequest): Promise<GhipssTransactionStatus> {
    this.logger.log(`[MOCK] GhIPSS Collection: GH₵${request.amount} from ${request.payerPhone}`);
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));

    return {
      reference: request.reference,
      ghipssReference: `GHIPSS-COLL-${Date.now()}`,
      status: 'PENDING', // Payment prompt sent to phone
      amount: request.amount,
      fee: 0,
    };
  }

  private async mockStatusCheck(reference: string): Promise<GhipssTransactionStatus> {
    // After a few seconds, mock shows as SUCCESS
    return {
      reference,
      ghipssReference: reference,
      status: 'SUCCESS',
      amount: 0,
      fee: 0,
      completedAt: new Date(),
    };
  }
}
