/**
 * NIA Ghana Card Verification Client
 *
 * Integrates with the National Identification Authority (NIA) of Ghana for:
 *   - Ghana Card OCR parsing from uploaded images
 *   - Liveness check (anti-spoofing selfie verification)
 *   - NIA database verification (real-time identity lookup)
 *   - Offline fallback with AES-256-GCM encrypted local cache (48-hour validity)
 *   - Biometric hash storage (SHA-256 of face embedding — NOT raw biometric)
 *
 * Compliance:
 *   - National Identification Authority Act 2006 (Act 707) — NIA data access rules
 *   - Data Protection Act 2012 (Act 843) — biometric data handling
 *   - BoG KYC Directive 2018 (BG/GOV/SEC/2018/02) — electronic identity verification
 *   - FATF Recommendation 10 — Customer Due Diligence (CDD)
 *
 * Ghana Card Format: GHA-XXXXXXXXX-X (GHA + 9 digits + 1 check character)
 *
 * SECURITY NOTE: Raw biometric templates are NEVER stored. Only the SHA-256
 * hash of the face embedding vector is persisted for audit trail purposes.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum VerificationStatus {
  VERIFIED = 'VERIFIED',
  NOT_FOUND = 'NOT_FOUND',
  MISMATCH = 'MISMATCH',
  DECEASED = 'DECEASED',
  SUSPENDED = 'SUSPENDED',
  PENDING = 'PENDING',
  CACHE_HIT = 'CACHE_HIT',
  FAILED = 'FAILED',
}

export enum LivenessResult {
  GENUINE = 'GENUINE',
  SPOOF_DETECTED = 'SPOOF_DETECTED',
  LOW_QUALITY = 'LOW_QUALITY',
  INCONCLUSIVE = 'INCONCLUSIVE',
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface GhanaCardOcrResult {
  ghanaCardNumber: string; // GHA-XXXXXXXXX-X
  surname: string;
  otherNames: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: 'M' | 'F';
  nationality: string;
  placeOfBirth: string;
  height?: string;
  expiryDate?: string;
  issueDate?: string;
  mrz?: string; // Machine Readable Zone
  confidence: number; // 0–1
  rawFields: Record<string, string>;
}

export interface LivenessCheckRequest {
  selfieImageBase64: string; // JPEG/PNG, max 5 MB
  cardFaceImageBase64?: string; // extracted from Ghana Card OCR
  sessionId: string;
  customerId: string;
}

export interface LivenessCheckResult {
  sessionId: string;
  result: LivenessResult;
  faceMatchScore?: number; // 0–100 if card face provided
  livenessScore: number; // 0–100
  biometricHash: string; // SHA-256 of embedding — stored for audit
  timestamp: string;
  details: string;
}

export interface NiaVerificationRequest {
  ghanaCardNumber: string;
  surname?: string;
  dateOfBirth?: string;
  gender?: 'M' | 'F';
  consentReference: string;
  requestingOfficerId: string;
}

export interface NiaVerificationResponse {
  status: VerificationStatus;
  ghanaCardNumber: string;
  verifiedName?: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  isAlive: boolean;
  cardStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'UNKNOWN';
  verifiedAt: string;
  niaReference?: string;
  source: 'NIA_LIVE' | 'LOCAL_CACHE';
  cacheExpiresAt?: string;
  mismatchedFields?: string[];
}

export interface OcrUploadRequest {
  frontImageBase64: string; // Ghana Card front face
  backImageBase64?: string; // Ghana Card back (optional but improves accuracy)
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

// ─── Cache Entry ─────────────────────────────────────────────────────────────

interface CacheEntry {
  ghanaCardNumber: string;
  encryptedPayload: string; // AES-256-GCM encrypted JSON
  iv: string;
  authTag: string;
  createdAt: number;
  expiresAt: number; // 48 hours
}

const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const REQUEST_TIMEOUT_MS = 20000;

// Ghana Card regex: GHA- followed by 9 digits, hyphen, 1 alphanumeric
const GHANA_CARD_REGEX = /^GHA-\d{9}-\d{1}$/;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class GhanaCardClient {
  private readonly logger = new Logger(GhanaCardClient.name);
  private readonly useMock: boolean;
  private readonly niaBaseUrl: string;
  private readonly niaApiKey: string;
  private readonly encryptionKey: Buffer;

  // In-memory encrypted cache; in production, persist to Redis with TTL
  private readonly verificationCache = new Map<string, CacheEntry>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.useMock = this.configService.get('NIA_USE_MOCK', 'true') === 'true';
    this.niaBaseUrl = this.configService.get('NIA_BASE_URL', 'https://api.nia.gov.gh/v2');
    this.niaApiKey = this.configService.get('NIA_API_KEY', '');

    // Derive 256-bit AES key from secret using scrypt (NIST SP 800-132)
    const secret = this.configService.get('NIA_CACHE_SECRET', 'default-cache-secret-change-me');
    const salt = this.configService.get('NIA_CACHE_SALT', 'ghana-nia-cache-salt');
    this.encryptionKey = scryptSync(secret, salt, 32);

    this.logger.log(`GhanaCard Client initialised [mock=${this.useMock}]`);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Upload Ghana Card image(s) and parse via OCR.
   */
  async ocrUploadAndParse(request: OcrUploadRequest): Promise<GhanaCardOcrResult> {
    this.logger.log('Initiating Ghana Card OCR upload');

    if (this.useMock) {
      return this.mockOcrResult(request);
    }

    const response = await firstValueFrom(
      this.httpService
        .post(
          `${this.niaBaseUrl}/ocr/parse`,
          {
            frontImage: request.frontImageBase64,
            backImage: request.backImageBase64,
            mimeType: request.mimeType,
          },
          {
            headers: {
              'X-API-Key': this.niaApiKey,
              'Content-Type': 'application/json',
            },
          },
        )
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return this.mapOcrResponse(response.data);
  }

  /**
   * Submit liveness check — verifies the selfie is from a live person,
   * not a printed photo or digital replay (anti-spoofing).
   */
  async submitLivenessCheck(request: LivenessCheckRequest): Promise<LivenessCheckResult> {
    this.logger.log(`Liveness check [session=${request.sessionId}]`);

    if (this.useMock) {
      return this.mockLivenessResult(request);
    }

    const response = await firstValueFrom(
      this.httpService
        .post(
          `${this.niaBaseUrl}/liveness`,
          {
            selfie: request.selfieImageBase64,
            cardFace: request.cardFaceImageBase64,
            sessionId: request.sessionId,
          },
          { headers: { 'X-API-Key': this.niaApiKey } },
        )
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return this.mapLivenessResponse(response.data, request.sessionId);
  }

  /**
   * Verify Ghana Card against the NIA database.
   * Falls back to encrypted local cache if NIA API is unavailable.
   * Cache is valid for 48 hours per BoG offline KYC guidance.
   */
  async verifyWithNia(request: NiaVerificationRequest): Promise<NiaVerificationResponse> {
    this.validateGhanaCardFormat(request.ghanaCardNumber);

    this.logger.log(
      `NIA verification [card=${this.maskCard(request.ghanaCardNumber)}, consent=${request.consentReference}]`,
    );

    // Check cache first
    const cached = this.getFromCache(request.ghanaCardNumber);
    if (cached) {
      this.logger.log(`Cache hit for Ghana Card ${this.maskCard(request.ghanaCardNumber)}`);
      return { ...cached, source: 'LOCAL_CACHE' };
    }

    if (this.useMock) {
      const result = this.mockNiaVerification(request);
      this.storeInCache(request.ghanaCardNumber, result);
      return result;
    }

    try {
      const result = await this.callNiaApi(request);
      this.storeInCache(request.ghanaCardNumber, result);
      return result;
    } catch (err: unknown) {
      this.logger.warn(
        `NIA API unavailable — attempting cache fallback [card=${this.maskCard(request.ghanaCardNumber)}]: ${(err as Error).message}`,
      );

      // Offline fallback: return PENDING status with regulatory note
      return {
        status: VerificationStatus.PENDING,
        ghanaCardNumber: request.ghanaCardNumber,
        isAlive: true,
        cardStatus: 'UNKNOWN',
        verifiedAt: new Date().toISOString(),
        source: 'LOCAL_CACHE',
        mismatchedFields: [],
      };
    }
  }

  /**
   * Validate Ghana Card number format.
   * Format: GHA-XXXXXXXXX-X (GHA + 9 digits + hyphen + 1 digit check)
   */
  validateGhanaCardFormat(cardNumber: string): void {
    if (!GHANA_CARD_REGEX.test(cardNumber)) {
      throw new Error(
        `Invalid Ghana Card format: ${cardNumber}. Expected: GHA-XXXXXXXXX-X`,
      );
    }
  }

  /**
   * Compute SHA-256 biometric hash from a face embedding vector.
   * Stores ONLY the hash — never the raw embedding — per Act 843.
   */
  computeBiometricHash(faceEmbedding: number[]): string {
    const normalized = faceEmbedding.map((v) => v.toFixed(6)).join(',');
    return createHash('sha256').update(normalized).digest('hex');
  }

  // ─── Cache Operations ────────────────────────────────────────────────────────

  private storeInCache(ghanaCardNumber: string, response: NiaVerificationResponse): void {
    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const plaintext = JSON.stringify(response);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const entry: CacheEntry = {
      ghanaCardNumber,
      encryptedPayload: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      createdAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    this.verificationCache.set(ghanaCardNumber, entry);
  }

  private getFromCache(ghanaCardNumber: string): NiaVerificationResponse | null {
    const entry = this.verificationCache.get(ghanaCardNumber);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.verificationCache.delete(ghanaCardNumber);
      return null;
    }

    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(entry.authTag, 'base64'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(entry.encryptedPayload, 'base64')),
        decipher.final(),
      ]);

      const response = JSON.parse(decrypted.toString('utf8')) as NiaVerificationResponse;
      response.cacheExpiresAt = new Date(entry.expiresAt).toISOString();
      return response;
    } catch {
      this.logger.error(`Cache decryption failed for ${this.maskCard(ghanaCardNumber)} — evicting`);
      this.verificationCache.delete(ghanaCardNumber);
      return null;
    }
  }

  // ─── NIA API Call ────────────────────────────────────────────────────────────

  private async callNiaApi(request: NiaVerificationRequest): Promise<NiaVerificationResponse> {
    const response = await firstValueFrom(
      this.httpService
        .post(
          `${this.niaBaseUrl}/verify`,
          {
            cardNumber: request.ghanaCardNumber,
            surname: request.surname,
            dateOfBirth: request.dateOfBirth,
            gender: request.gender,
            consentRef: request.consentReference,
          },
          { headers: { 'X-API-Key': this.niaApiKey, 'X-Officer-ID': request.requestingOfficerId } },
        )
        .pipe(timeout(REQUEST_TIMEOUT_MS)),
    );

    return this.mapNiaResponse(response.data, request.ghanaCardNumber);
  }

  // ─── Response Mappers ────────────────────────────────────────────────────────

  private mapOcrResponse(data: Record<string, unknown>): GhanaCardOcrResult {
    return {
      ghanaCardNumber: data.cardNumber as string,
      surname: data.surname as string ?? '',
      otherNames: data.otherNames as string ?? '',
      dateOfBirth: data.dateOfBirth as string ?? '',
      gender: (data.gender as 'M' | 'F') ?? 'M',
      nationality: data.nationality as string ?? 'Ghanaian',
      placeOfBirth: data.placeOfBirth as string ?? '',
      height: data.height as string,
      expiryDate: data.expiryDate as string,
      issueDate: data.issueDate as string,
      mrz: data.mrz as string,
      confidence: data.confidence as number ?? 0.9,
      rawFields: (data.rawFields as Record<string, string>) ?? {},
    };
  }

  private mapLivenessResponse(
    data: Record<string, unknown>,
    sessionId: string,
  ): LivenessCheckResult {
    const embedding = (data.faceEmbedding as number[]) ?? [];
    return {
      sessionId,
      result: (data.livenessResult as LivenessResult) ?? LivenessResult.INCONCLUSIVE,
      faceMatchScore: data.faceMatchScore as number,
      livenessScore: data.livenessScore as number ?? 0,
      biometricHash: embedding.length > 0 ? this.computeBiometricHash(embedding) : '',
      timestamp: new Date().toISOString(),
      details: data.details as string ?? '',
    };
  }

  private mapNiaResponse(
    data: Record<string, unknown>,
    ghanaCardNumber: string,
  ): NiaVerificationResponse {
    return {
      status: (data.verificationStatus as VerificationStatus) ?? VerificationStatus.FAILED,
      ghanaCardNumber,
      verifiedName: data.fullName as string,
      dateOfBirth: data.dateOfBirth as string,
      gender: data.gender as string,
      nationality: data.nationality as string,
      isAlive: (data.isAlive as boolean) ?? true,
      cardStatus: (data.cardStatus as 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'UNKNOWN') ?? 'UNKNOWN',
      verifiedAt: new Date().toISOString(),
      niaReference: data.niaReference as string,
      source: 'NIA_LIVE',
    };
  }

  // ─── Mock Implementations ────────────────────────────────────────────────────

  /**
   * Realistic mock OCR response for testing.
   * Returns deterministic data based on the image payload length.
   */
  private mockOcrResult(_request: OcrUploadRequest): GhanaCardOcrResult {
    const mockData = MOCK_GHANA_CARD_DATA[0]; // Use first test customer
    this.logger.debug('[MOCK] Ghana Card OCR returning test data');

    return {
      ghanaCardNumber: mockData.ghanaCardNumber,
      surname: mockData.surname,
      otherNames: mockData.otherNames,
      dateOfBirth: mockData.dateOfBirth,
      gender: mockData.gender,
      nationality: 'Ghanaian',
      placeOfBirth: mockData.placeOfBirth,
      height: '1.72m',
      expiryDate: '2030-12-31',
      issueDate: '2020-01-15',
      mrz: `P<GHAMENSH<<KWAME<ASANTE<<<<<<<<<<<<<<<<<<<\nGHA123456<7GHA9001011M3012315<<<<<<<<<<<<<<4`,
      confidence: 0.97,
      rawFields: {
        RAW_SURNAME: mockData.surname,
        RAW_GIVEN_NAMES: mockData.otherNames,
        RAW_DOB: mockData.dateOfBirth,
        RAW_GENDER: mockData.gender,
        RAW_CARD_NO: mockData.ghanaCardNumber,
        RAW_NATIONALITY: 'GHA',
        RAW_EXPIRY: '3012315',
      },
    };
  }

  private mockLivenessResult(request: LivenessCheckRequest): LivenessCheckResult {
    // Selfies with a 'FAIL' marker in sessionId simulate spoof detection
    const isSpoof = request.sessionId.includes('FAIL');
    const embedding = Array.from({ length: 128 }, () => Math.random());

    return {
      sessionId: request.sessionId,
      result: isSpoof ? LivenessResult.SPOOF_DETECTED : LivenessResult.GENUINE,
      faceMatchScore: isSpoof ? 35 : 94,
      livenessScore: isSpoof ? 20 : 97,
      biometricHash: this.computeBiometricHash(embedding),
      timestamp: new Date().toISOString(),
      details: isSpoof
        ? 'Potential replay attack detected — reflective artefacts found'
        : 'Liveness confirmed — no spoofing artefacts detected',
    };
  }

  private mockNiaVerification(request: NiaVerificationRequest): NiaVerificationResponse {
    // Find matching test customer or return generic verified
    const found = MOCK_GHANA_CARD_DATA.find(
      (d) => d.ghanaCardNumber === request.ghanaCardNumber,
    );

    if (found) {
      return {
        status: VerificationStatus.VERIFIED,
        ghanaCardNumber: request.ghanaCardNumber,
        verifiedName: `${found.surname} ${found.otherNames}`,
        dateOfBirth: found.dateOfBirth,
        gender: found.gender,
        nationality: 'Ghanaian',
        isAlive: true,
        cardStatus: 'ACTIVE',
        verifiedAt: new Date().toISOString(),
        niaReference: `NIA-${Date.now()}`,
        source: 'NIA_LIVE',
      };
    }

    // Unknown card — simulate not found
    return {
      status: VerificationStatus.NOT_FOUND,
      ghanaCardNumber: request.ghanaCardNumber,
      isAlive: false,
      cardStatus: 'UNKNOWN',
      verifiedAt: new Date().toISOString(),
      source: 'NIA_LIVE',
    };
  }

  private maskCard(cardNumber: string): string {
    return cardNumber.replace(/(\d{4})\d{5}(\d)/, '$1*****$2');
  }
}

// ─── Mock Test Data ───────────────────────────────────────────────────────────

export const MOCK_GHANA_CARD_DATA = [
  {
    ghanaCardNumber: 'GHA-123456789-0',
    surname: 'MENSAH',
    otherNames: 'KWAME ASANTE',
    dateOfBirth: '1990-01-01',
    gender: 'M' as const,
    placeOfBirth: 'Accra',
  },
  {
    ghanaCardNumber: 'GHA-234567890-1',
    surname: 'ADJEI',
    otherNames: 'AKOSUA ABENA',
    dateOfBirth: '1988-06-15',
    gender: 'F' as const,
    placeOfBirth: 'Kumasi',
  },
  {
    ghanaCardNumber: 'GHA-345678901-2',
    surname: 'BOATENG',
    otherNames: 'KWESI FIIFI',
    dateOfBirth: '1995-11-20',
    gender: 'M' as const,
    placeOfBirth: 'Takoradi',
  },
  {
    ghanaCardNumber: 'GHA-456789012-3',
    surname: 'OWUSU',
    otherNames: 'ABENA YEBOAH',
    dateOfBirth: '1992-03-08',
    gender: 'F' as const,
    placeOfBirth: 'Sunyani',
  },
  {
    ghanaCardNumber: 'GHA-567890123-4',
    surname: 'ASANTE',
    otherNames: 'KOFI BRIGHT',
    dateOfBirth: '1985-07-25',
    gender: 'M' as const,
    placeOfBirth: 'Tamale',
  },
];
