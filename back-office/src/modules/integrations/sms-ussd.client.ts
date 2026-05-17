/**
 * SMS/USSD Client
 *
 * Integrates with:
 *   - mNotify Ghana (primary SMS)
 *   - Hubtel Messaging (secondary SMS + USSD)
 *
 * Features:
 *   - Multi-language SMS templates: English, Twi, Ga, Ewe, Hausa
 *   - USSD session management
 *   - Delivery receipt tracking
 *   - Voice fallback (TTS via Hubtel)
 *   - OTP generation and verification (6-digit, 5-minute TTL)
 *
 * Compliance:
 *   - NCA SMS Guidelines 2021
 *   - Data Protection Act 2012 (Act 843) — phone numbers are PII
 *   - Electronic Communications Act 2008 (Act 775)
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHmac, randomInt } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum SmsProvider {
  MNOTIFY = 'MNOTIFY',
  HUBTEL = 'HUBTEL',
}

export enum Language {
  ENGLISH = 'en',
  TWI = 'tw',
  GA = 'ga',
  EWE = 'ee',
  HAUSA = 'ha',
}

export enum SmsTemplateKey {
  LOAN_APPROVED = 'LOAN_APPROVED',
  LOAN_DISBURSED = 'LOAN_DISBURSED',
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  LOAN_OVERDUE = 'LOAN_OVERDUE',
  OTP_VERIFICATION = 'OTP_VERIFICATION',
  ACCOUNT_CREATED = 'ACCOUNT_CREATED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  KYC_APPROVED = 'KYC_APPROVED',
  KYC_REJECTED = 'KYC_REJECTED',
}

export enum UssdSessionStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  TIMED_OUT = 'TIMED_OUT',
  ABANDONED = 'ABANDONED',
}

export enum DeliveryStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface SendSmsRequest {
  to: string | string[]; // Ghanaian MSISDN(s)
  templateKey: SmsTemplateKey;
  language?: Language;
  variables: Record<string, string>;
  senderId?: string;
  scheduleAt?: string; // ISO 8601 for scheduled SMS
}

export interface SmsResponse {
  provider: SmsProvider;
  messageId: string;
  status: DeliveryStatus;
  recipient: string;
  sentAt: string;
  credits?: number;
  message: string;
}

export interface DeliveryReport {
  messageId: string;
  recipient: string;
  status: DeliveryStatus;
  deliveredAt?: string;
  failureReason?: string;
  provider: SmsProvider;
}

export interface UssdSessionRequest {
  sessionId: string;
  msisdn: string;
  serviceCode: string; // e.g., *714*1#
  input?: string; // user's USSD input
  sessionStatus?: UssdSessionStatus;
}

export interface UssdResponse {
  sessionId: string;
  message: string; // text to display on phone
  continueSession: boolean; // true = CON, false = END
  options?: string[]; // menu items (will be numbered automatically)
}

export interface OtpRequest {
  msisdn: string;
  purpose: string;
  userId: string;
  deliveryChannel?: 'SMS' | 'VOICE';
  language?: Language;
}

export interface OtpVerifyRequest {
  msisdn: string;
  otp: string;
  userId: string;
}

export interface VoiceCallRequest {
  msisdn: string;
  message: string;
  language?: Language;
  senderId?: string;
}

// ─── OTP Store (use Redis in production) ─────────────────────────────────────

interface OtpEntry {
  otp: string;
  userId: string;
  msisdn: string;
  purpose: string;
  attempts: number;
  expiresAt: number;
  createdAt: number;
}

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15000;

// ─── SMS Templates ────────────────────────────────────────────────────────────

type TemplateMap = Record<SmsTemplateKey, Record<Language, string>>;

const SMS_TEMPLATES: TemplateMap = {
  [SmsTemplateKey.LOAN_APPROVED]: {
    [Language.ENGLISH]: 'Dear {{name}}, your loan of GHS {{amount}} has been approved. Disbursement within 24hrs. Ref: {{ref}}. Ghana Savings & Loans.',
    [Language.TWI]: 'Akyire {{name}}, wʼadesua a ɛyɛ GHS {{amount}} wɔ mu. Awotwe bɛba ɔda 24 mu. Ref: {{ref}}. Ghana Savings & Loans.',
    [Language.GA]: 'Ofaine {{name}}, loan {{amount}} GHS bɛ approve. Disbursement 24 hrs mu. Ref: {{ref}}. Ghana Savings & Loans.',
    [Language.EWE]: '{{name}}, eda la GHS {{amount}} kpɔe wòwò. Gbɔsɔsɔ 24 gaƒoƒo me. Ref: {{ref}}. Ghana Savings & Loans.',
    [Language.HAUSA]: '{{name}}, lamuni GHS {{amount}} ya amince. Za a aika kudin cikin awanni 24. Ref: {{ref}}. Ghana Savings & Loans.',
  },
  [SmsTemplateKey.LOAN_DISBURSED]: {
    [Language.ENGLISH]: 'GHS {{amount}} has been sent to your mobile wallet {{msisdn}}. Loan Ref: {{ref}}. First repayment due {{dueDate}}. Ghana Savings & Loans.',
    [Language.TWI]: 'GHS {{amount}} akɔ wo mobile wallet {{msisdn}} mu. Loan Ref: {{ref}}. Tua ɔkwa a edi kan {{dueDate}}. Ghana S&L.',
    [Language.GA]: 'GHS {{amount}} kɔɔ mobile wallet {{msisdn}} mu. Ref: {{ref}}. Repayment etɛ {{dueDate}}. Ghana S&L.',
    [Language.EWE]: 'GHS {{amount}} dzo na {{msisdn}} me. Ref: {{ref}}. Eda gbɔsɔsɔ bliboa {{dueDate}}. Ghana S&L.',
    [Language.HAUSA]: 'An aika GHS {{amount}} zuwa {{msisdn}}. Ref: {{ref}}. Biyan farko {{dueDate}}. Ghana S&L.',
  },
  [SmsTemplateKey.PAYMENT_REMINDER]: {
    [Language.ENGLISH]: 'REMINDER: GHS {{amount}} loan repayment due on {{dueDate}}. Pay via *714*1# or mobile app. Ref: {{ref}}. Ghana Savings & Loans.',
    [Language.TWI]: 'NSƐM: Tua GHS {{amount}} loan kyɛ {{dueDate}}. Tua wɔ *714*1# anaa app so. Ref: {{ref}}. Ghana S&L.',
    [Language.GA]: 'NSƐM: Loan {{amount}} GHS etɛ {{dueDate}}. Pay wɔ *714*1# anaa app. Ref: {{ref}}. Ghana S&L.',
    [Language.EWE]: 'DZƆDZƆE: Eda GHS {{amount}} vɔ {{dueDate}}. Gbɔ wò *714*1# de. Ref: {{ref}}. Ghana S&L.',
    [Language.HAUSA]: 'TUNAWA: Biyan GHS {{amount}} ranar {{dueDate}}. Biya ta *714*1#. Ref: {{ref}}. Ghana S&L.',
  },
  [SmsTemplateKey.PAYMENT_RECEIVED]: {
    [Language.ENGLISH]: 'Payment of GHS {{amount}} received. Balance: GHS {{balance}}. Thank you! Ref: {{ref}}. Ghana Savings & Loans.',
    [Language.TWI]: 'Yɛakyia GHS {{amount}} tua. Balance: GHS {{balance}}. Medaase! Ref: {{ref}}. Ghana S&L.',
    [Language.GA]: 'GHS {{amount}} bɛ receive. Balance: GHS {{balance}}. Meda wo ase! Ref: {{ref}}. Ghana S&L.',
    [Language.EWE]: 'GHS {{amount}} dzo. Ativɔ: GHS {{balance}}. Akpe! Ref: {{ref}}. Ghana S&L.',
    [Language.HAUSA]: 'An karɓi GHS {{amount}}. Sauran: GHS {{balance}}. Na gode! Ref: {{ref}}. Ghana S&L.',
  },
  [SmsTemplateKey.LOAN_OVERDUE]: {
    [Language.ENGLISH]: 'URGENT: Your loan repayment of GHS {{amount}} is {{days}} day(s) overdue. Please pay immediately to avoid additional charges. Call {{phone}}. Ghana Savings & Loans.',
    [Language.TWI]: 'NTENA: Wo loan tua GHS {{amount}} kyɛe {{days}} da(kuo). Tua ntɛm ara. Tel: {{phone}}. Ghana S&L.',
    [Language.GA]: 'NTENA: Loan {{amount}} GHS daa {{days}} da. Pay ntɛm. Tel: {{phone}}. Ghana S&L.',
    [Language.EWE]: 'NYUITETE: Eda GHS {{amount}} vɔ {{days}} ŋkeke la. Gbɔ sɔ. Tel: {{phone}}. Ghana S&L.',
    [Language.HAUSA]: 'GAGGAWA: Biyan GHS {{amount}} ya makara kwanaki {{days}}. Ka biya yanzu. Tel: {{phone}}. Ghana S&L.',
  },
  [SmsTemplateKey.OTP_VERIFICATION]: {
    [Language.ENGLISH]: 'Your Ghana S&L verification code is: {{otp}}. Valid for 5 minutes. Never share this code.',
    [Language.TWI]: 'Wo Ghana S&L nsɛntwerɛ kɔd ne: {{otp}}. Ɛwɔ ho sɛ minit 5. Mfa ntoma biara.',
    [Language.GA]: 'Ghana S&L code: {{otp}}. Valid minit 5. Mfa biribi.',
    [Language.EWE]: 'Ghana S&L kɔd: {{otp}}. Wòtunɔ miniti 5. Mede ŋu na ame o.',
    [Language.HAUSA]: 'Lambar tabbatarwa Ghana S&L: {{otp}}. Na mintoci 5. Kada ka ba wani.',
  },
  [SmsTemplateKey.ACCOUNT_CREATED]: {
    [Language.ENGLISH]: 'Welcome to Ghana Savings & Loans! Account {{accountNumber}} created. Download our app or dial *714#. Support: {{phone}}.',
    [Language.TWI]: 'Akwaaba Ghana Savings & Loans! Account {{accountNumber}} da ho. Download app anaa kyer *714#. Tumi: {{phone}}.',
    [Language.GA]: 'Akwaaba Ghana S&L! Account {{accountNumber}} da ho. Download app anaa kyer *714#. Tel: {{phone}}.',
    [Language.EWE]: 'Woezon Ghana S&L! Akaunti {{accountNumber}} da ho. Sɔ app anaa kyer *714#. Kpe: {{phone}}.',
    [Language.HAUSA]: 'Barka da zuwa Ghana S&L! Asusun {{accountNumber}} da. Saukar app ko buga *714#. Tel: {{phone}}.',
  },
  [SmsTemplateKey.ACCOUNT_SUSPENDED]: {
    [Language.ENGLISH]: 'Your Ghana S&L account has been temporarily suspended. Please contact us at {{phone}} or visit our nearest branch. Ref: {{ref}}.',
    [Language.TWI]: 'Wo Ghana S&L account wɔ krataa. Frɛ {{phone}} anaa kɔ branch bi. Ref: {{ref}}.',
    [Language.GA]: 'Ghana S&L account suspend. Frɛ {{phone}}. Ref: {{ref}}.',
    [Language.EWE]: 'Ghana S&L akaunti la wò krataa. Kpe {{phone}}. Ref: {{ref}}.',
    [Language.HAUSA]: 'An dakatar da asusun Ghana S&L. Tuntuɓi {{phone}}. Ref: {{ref}}.',
  },
  [SmsTemplateKey.PASSWORD_RESET]: {
    [Language.ENGLISH]: 'Your Ghana S&L password reset code: {{otp}}. Expires in 5 minutes. If you did not request this, call {{phone}} immediately.',
    [Language.TWI]: 'Ghana S&L password reset kɔd: {{otp}}. Minit 5 akyi na ɛsa. Sɛ woanpɛ saa a, frɛ {{phone}}.',
    [Language.GA]: 'Password reset kɔd: {{otp}}. Minit 5. Sɛ woanpɛ a, frɛ {{phone}}.',
    [Language.EWE]: 'Password reset kɔd: {{otp}}. Miniti 5. Ne iwɔ ne o a, kpe {{phone}}.',
    [Language.HAUSA]: 'Lamba sauya kalmar sirri: {{otp}}. Mintoci 5. Idan kai ba ka nema ba, kira {{phone}}.',
  },
  [SmsTemplateKey.KYC_APPROVED]: {
    [Language.ENGLISH]: 'KYC verified! Your Ghana S&L account {{accountNumber}} is now fully active. You can now access all services. Ghana Savings & Loans.',
    [Language.TWI]: 'KYC da ho! Wo account {{accountNumber}} da tɔ. Ghana Savings & Loans.',
    [Language.GA]: 'KYC da ho! Account {{accountNumber}} active. Ghana S&L.',
    [Language.EWE]: 'KYC kpɔe! Akaunti {{accountNumber}} da wòwo. Ghana S&L.',
    [Language.HAUSA]: 'KYC ya tabbata! Asusun {{accountNumber}} yana aiki. Ghana S&L.',
  },
  [SmsTemplateKey.KYC_REJECTED]: {
    [Language.ENGLISH]: 'KYC verification failed. Reason: {{reason}}. Please visit our branch with valid Ghana Card. Support: {{phone}}. Ghana Savings & Loans.',
    [Language.TWI]: 'KYC mpɔ so. Reason: {{reason}}. Kɔ branch wɔ Ghana Card pa. Tel: {{phone}}. Ghana S&L.',
    [Language.GA]: 'KYC failed. Reason: {{reason}}. Kɔ branch wɔ Ghana Card. Tel: {{phone}}. Ghana S&L.',
    [Language.EWE]: 'KYC hafi. Reason: {{reason}}. Yi branch wɔ Ghana Card. Tel: {{phone}}. Ghana S&L.',
    [Language.HAUSA]: 'KYC ya kasa. Dalilin: {{reason}}. Je reshe da Ghana Card. Tel: {{phone}}. Ghana S&L.',
  },
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SmsUssdClient {
  private readonly logger = new Logger(SmsUssdClient.name);
  private readonly useMock: boolean;
  private readonly mnotifyApiKey: string;
  private readonly mnotifySenderId: string;
  private readonly hubtelClientId: string;
  private readonly hubtelClientSecret: string;
  private readonly hubtelSenderId: string;
  private readonly defaultProvider: SmsProvider;

  // In-memory OTP store — use Redis in production with TTL
  private readonly otpStore = new Map<string, OtpEntry>();

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.useMock = configService.get('SMS_USE_MOCK', 'true') === 'true';
    this.mnotifyApiKey = configService.get('MNOTIFY_API_KEY', '');
    this.mnotifySenderId = configService.get('MNOTIFY_SENDER_ID', 'GhSavings');
    this.hubtelClientId = configService.get('HUBTEL_SMS_CLIENT_ID', '');
    this.hubtelClientSecret = configService.get('HUBTEL_SMS_CLIENT_SECRET', '');
    this.hubtelSenderId = configService.get('HUBTEL_SENDER_ID', 'GhSavings');
    this.defaultProvider = (configService.get('SMS_DEFAULT_PROVIDER', 'MNOTIFY') as SmsProvider);

    this.logger.log(`SMS/USSD Client initialised [mock=${this.useMock}, provider=${this.defaultProvider}]`);
  }

  // ─── SMS ──────────────────────────────────────────────────────────────────────

  /**
   * Send SMS using a pre-defined template in the specified language.
   * Automatically falls back from mNotify → Hubtel on failure.
   */
  async sendSms(request: SendSmsRequest): Promise<SmsResponse[]> {
    const language = request.language ?? Language.ENGLISH;
    const template = this.getTemplate(request.templateKey, language);
    const message = this.interpolate(template, request.variables);
    const recipients = Array.isArray(request.to) ? request.to : [request.to];

    this.logger.log(
      `Sending SMS [template=${request.templateKey}, lang=${language}, recipients=${recipients.length}]`,
    );

    if (this.useMock) {
      return this.mockSendSms(recipients, message);
    }

    try {
      return await this.sendViaMnotify(recipients, message, request.senderId);
    } catch (err) {
      this.logger.warn(`mNotify failed: ${(err as Error).message} — falling back to Hubtel`);
      return this.sendViaHubtel(recipients, message, request.senderId);
    }
  }

  /**
   * Get delivery report for a message ID.
   */
  async getDeliveryReport(messageId: string, provider?: SmsProvider): Promise<DeliveryReport> {
    const p = provider ?? this.defaultProvider;

    if (this.useMock) {
      return {
        messageId,
        recipient: '0244000000',
        status: DeliveryStatus.DELIVERED,
        deliveredAt: new Date().toISOString(),
        provider: p,
      };
    }

    if (p === SmsProvider.MNOTIFY) {
      return this.getMnotifyDeliveryReport(messageId);
    }
    return this.getHubtelDeliveryReport(messageId);
  }

  // ─── USSD ─────────────────────────────────────────────────────────────────────

  /**
   * Process a USSD session request from the telecom operator.
   * This is a request handler — your controller calls this with the operator's payload.
   */
  processUssdRequest(request: UssdSessionRequest): UssdResponse {
    this.logger.log(
      `USSD session [id=${request.sessionId}, msisdn=${request.msisdn}, input=${request.input ?? 'INIT'}]`,
    );

    // Route to the appropriate menu handler based on user input
    if (!request.input) {
      return this.ussdMainMenu();
    }

    const inputs = request.input.split('*').filter(Boolean);
    return this.routeUssdMenu(inputs, request.msisdn);
  }

  // ─── OTP ──────────────────────────────────────────────────────────────────────

  /**
   * Generate and send a 6-digit OTP via SMS (or voice if specified).
   * OTP is valid for 5 minutes and can only be attempted 3 times.
   */
  async generateAndSendOtp(request: OtpRequest): Promise<{ messageId: string; expiresAt: string }> {
    const otp = this.generateOtp();
    const key = `${request.msisdn}:${request.userId}`;

    this.otpStore.set(key, {
      otp,
      userId: request.userId,
      msisdn: request.msisdn,
      purpose: request.purpose,
      attempts: 0,
      expiresAt: Date.now() + OTP_TTL_MS,
      createdAt: Date.now(),
    });

    this.logger.log(`OTP generated [user=${request.userId}, purpose=${request.purpose}]`);

    if (request.deliveryChannel === 'VOICE') {
      await this.sendVoiceFallback({
        msisdn: request.msisdn,
        message: `Your verification code is ${otp.split('').join(' ')}. Repeat: ${otp.split('').join(' ')}.`,
        language: request.language,
      });
    } else {
      await this.sendSms({
        to: request.msisdn,
        templateKey: SmsTemplateKey.OTP_VERIFICATION,
        language: request.language ?? Language.ENGLISH,
        variables: { otp },
      });
    }

    return {
      messageId: `OTP-${Date.now()}`,
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    };
  }

  /**
   * Verify an OTP. Returns true if valid; throws on expired/exceeded attempts.
   */
  verifyOtp(request: OtpVerifyRequest): boolean {
    const key = `${request.msisdn}:${request.userId}`;
    const entry = this.otpStore.get(key);

    if (!entry) throw new Error('OTP not found or already used');
    if (Date.now() > entry.expiresAt) {
      this.otpStore.delete(key);
      throw new Error('OTP expired');
    }
    if (entry.attempts >= OTP_MAX_ATTEMPTS) {
      this.otpStore.delete(key);
      throw new Error('OTP attempts exceeded — please request a new code');
    }

    entry.attempts++;

    if (entry.otp !== request.otp) {
      this.logger.warn(
        `OTP mismatch [user=${request.userId}, attempt=${entry.attempts}/${OTP_MAX_ATTEMPTS}]`,
      );
      if (entry.attempts >= OTP_MAX_ATTEMPTS) {
        this.otpStore.delete(key);
        throw new Error('OTP attempts exceeded');
      }
      return false;
    }

    // Valid — consume OTP
    this.otpStore.delete(key);
    this.logger.log(`OTP verified [user=${request.userId}]`);
    return true;
  }

  // ─── Voice Fallback ───────────────────────────────────────────────────────────

  async sendVoiceFallback(request: VoiceCallRequest): Promise<void> {
    if (this.useMock) {
      this.logger.debug(`[MOCK] Voice call to ${request.msisdn}: "${request.message}"`);
      return;
    }

    const token = Buffer.from(`${this.hubtelClientId}:${this.hubtelClientSecret}`).toString('base64');
    await firstValueFrom(
      this.http
        .post(
          'https://api.hubtel.com/v2/voice/calls',
          {
            From: this.hubtelSenderId,
            To: this.normalizePhone(request.msisdn),
            Text: request.message,
            Language: request.language ?? Language.ENGLISH,
          },
          { headers: { Authorization: `Basic ${token}` } },
        )
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );
  }

  // ─── Private SMS Providers ───────────────────────────────────────────────────

  private async sendViaMnotify(
    recipients: string[],
    message: string,
    senderId?: string,
  ): Promise<SmsResponse[]> {
    const responses: SmsResponse[] = [];

    for (const recipient of recipients) {
      const resp = await firstValueFrom(
        this.http
          .post(
            'https://apps.mnotify.net/smsapi',
            null,
            {
              params: {
                key: this.mnotifyApiKey,
                to: this.normalizePhone(recipient),
                msg: message,
                sender_id: senderId ?? this.mnotifySenderId,
              },
            },
          )
          .pipe(timeout(REQUEST_TIMEOUT_MS)),
      );

      responses.push({
        provider: SmsProvider.MNOTIFY,
        messageId: resp.data.code?.toString() ?? `MN-${Date.now()}`,
        status: resp.data.status === '1000' ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
        recipient,
        sentAt: new Date().toISOString(),
        credits: resp.data.credits_used,
        message: resp.data.title ?? '',
      });
    }

    return responses;
  }

  private async sendViaHubtel(
    recipients: string[],
    message: string,
    senderId?: string,
  ): Promise<SmsResponse[]> {
    const token = Buffer.from(`${this.hubtelClientId}:${this.hubtelClientSecret}`).toString('base64');
    const responses: SmsResponse[] = [];

    for (const recipient of recipients) {
      const resp = await firstValueFrom(
        this.http
          .post(
            'https://api.hubtel.com/v2/messages/send',
            {
              From: senderId ?? this.hubtelSenderId,
              To: this.normalizePhone(recipient),
              Content: message,
            },
            { headers: { Authorization: `Basic ${token}` } },
          )
          .pipe(timeout(REQUEST_TIMEOUT_MS)),
      );

      responses.push({
        provider: SmsProvider.HUBTEL,
        messageId: resp.data.data?.messageId ?? `HB-${Date.now()}`,
        status: resp.data.responseCode === '0000' ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
        recipient,
        sentAt: new Date().toISOString(),
        message: resp.data.responseMessage ?? '',
      });
    }

    return responses;
  }

  private async getMnotifyDeliveryReport(messageId: string): Promise<DeliveryReport> {
    const resp = await firstValueFrom(
      this.http
        .get('https://apps.mnotify.net/smsapi/delivery-status', {
          params: { key: this.mnotifyApiKey, msgid: messageId },
        })
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return {
      messageId,
      recipient: resp.data.recipient ?? '',
      status: resp.data.status === 'DELIVERED' ? DeliveryStatus.DELIVERED : DeliveryStatus.UNKNOWN,
      deliveredAt: resp.data.deliveredAt,
      provider: SmsProvider.MNOTIFY,
    };
  }

  private async getHubtelDeliveryReport(messageId: string): Promise<DeliveryReport> {
    const token = Buffer.from(`${this.hubtelClientId}:${this.hubtelClientSecret}`).toString('base64');
    const resp = await firstValueFrom(
      this.http
        .get(`https://api.hubtel.com/v2/messages/${messageId}`, {
          headers: { Authorization: `Basic ${token}` },
        })
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return {
      messageId,
      recipient: resp.data.data?.to ?? '',
      status: resp.data.data?.status === 'Delivered' ? DeliveryStatus.DELIVERED : DeliveryStatus.UNKNOWN,
      deliveredAt: resp.data.data?.deliveredAt,
      provider: SmsProvider.HUBTEL,
    };
  }

  // ─── USSD Menu Logic ──────────────────────────────────────────────────────────

  private ussdMainMenu(): UssdResponse {
    return {
      sessionId: '',
      message: 'Welcome to Ghana S&L\n1. Check Balance\n2. Make Payment\n3. Loan Status\n4. Request Loan\n5. My Account',
      continueSession: true,
      options: ['Check Balance', 'Make Payment', 'Loan Status', 'Request Loan', 'My Account'],
    };
  }

  private routeUssdMenu(inputs: string[], msisdn: string): UssdResponse {
    const [first, ...rest] = inputs;

    switch (first) {
      case '1':
        return {
          sessionId: '',
          message: `Balance Enquiry\nDial *714*1# from registered number ${msisdn}\n\nAccount: Checking...\nYour loan balance will be sent via SMS.`,
          continueSession: false,
        };
      case '2':
        if (!rest[0]) {
          return {
            sessionId: '',
            message: 'Make Payment\nEnter loan reference number:',
            continueSession: true,
          };
        }
        return {
          sessionId: '',
          message: `Payment for loan ${rest[0]}\nEnter amount (GHS):`,
          continueSession: true,
        };
      case '3':
        return {
          sessionId: '',
          message: 'Loan status will be sent to your number via SMS within 2 minutes.',
          continueSession: false,
        };
      case '4':
        return {
          sessionId: '',
          message: 'Loan Request\nVisit any branch or download our app to apply.\nDial *714*4# for quick loan eligibility check.',
          continueSession: false,
        };
      case '5':
        return {
          sessionId: '',
          message: 'My Account\n1. Change PIN\n2. Update Phone\n3. Contact Us',
          continueSession: true,
        };
      default:
        return {
          sessionId: '',
          message: 'Invalid selection. Please dial *714# to start again.',
          continueSession: false,
        };
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private getTemplate(key: SmsTemplateKey, language: Language): string {
    const template = SMS_TEMPLATES[key]?.[language];
    if (!template) {
      this.logger.warn(`Template not found [key=${key}, lang=${language}] — falling back to English`);
      return SMS_TEMPLATES[key]?.[Language.ENGLISH] ?? '';
    }
    return template;
  }

  private interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  private normalizePhone(msisdn: string): string {
    return msisdn.replace(/^\+233/, '0').replace(/^233/, '0');
  }

  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }

  // ─── Mock ─────────────────────────────────────────────────────────────────────

  private mockSendSms(recipients: string[], message: string): SmsResponse[] {
    this.logger.debug(`[MOCK] SMS to ${recipients.join(', ')}: "${message.substring(0, 60)}..."`);
    return recipients.map((r) => ({
      provider: SmsProvider.MNOTIFY,
      messageId: `MOCK-SMS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: DeliveryStatus.SENT,
      recipient: r,
      sentAt: new Date().toISOString(),
      credits: 1,
      message: '[MOCK] SMS delivered',
    }));
  }
}
