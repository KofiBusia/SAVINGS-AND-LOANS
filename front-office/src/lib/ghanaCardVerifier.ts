/**
 * Ghana Card Verification Client
 *
 * Handles OCR parsing, format validation, and NIA API verification
 * for Ghana Card (National Identity Card issued by NIA).
 *
 * Card format: GHA-XXXXXXXX-X (where X is a digit)
 * Example: GHA-123456789-0
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GhanaCardData {
  cardNumber: string;
  surname: string;
  givenNames: string;
  dateOfBirth: string;
  sex: 'M' | 'F';
  nationality: string;
  personalIdNumber: string;
  issueDate: string;
  expiryDate: string;
  height?: string;
  mrz?: string;
}

export interface GhanaCardVerificationResult {
  valid: boolean;
  formatValid: boolean;
  niaVerified: boolean | null;
  biometricMatch: boolean | null;
  extractedData?: GhanaCardData;
  error?: string;
  errorCode?:
    | 'INVALID_FORMAT'
    | 'NIA_API_UNAVAILABLE'
    | 'NIA_NOT_FOUND'
    | 'NIA_BIOMETRIC_MISMATCH'
    | 'NIA_EXPIRED'
    | 'OCR_FAILED'
    | 'NETWORK_ERROR';
  verifiedAt?: string;
  cached?: boolean;
}

export interface OcrExtractionResult {
  success: boolean;
  cardData?: Partial<GhanaCardData>;
  confidence: number;
  rawText: string;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GHANA_CARD_REGEX = /^GHA-\d{8}-\d$/;
const GHANA_CARD_LOOSE_REGEX = /GHA[- ]?(\d{8})[- ](\d)/;

const VERIFICATION_CACHE_KEY_PREFIX = 'ghana-card-verify-';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Format Validation ────────────────────────────────────────────────────────

/**
 * Validates Ghana Card number format.
 * Pattern: GHA-XXXXXXXX-X (8 digits, then check digit)
 */
export function validateGhanaCardFormat(cardNumber: string): boolean {
  const normalized = normalizeCardNumber(cardNumber);
  return GHANA_CARD_REGEX.test(normalized);
}

/**
 * Normalizes Ghana Card number — trims, uppercases, fixes common OCR mistakes.
 */
export function normalizeCardNumber(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[O]/g, '0') // OCR mistake: letter O → digit 0
    .replace(/[I]/g, '1') // OCR mistake: letter I → digit 1
    .replace(/\s+/g, '-') // spaces to hyphens
    .replace(/--+/g, '-'); // collapse multiple hyphens
}

/**
 * Attempts to extract Ghana Card number from OCR text.
 */
export function extractCardNumberFromOcr(ocrText: string): string | null {
  const match = ocrText.toUpperCase().match(GHANA_CARD_LOOSE_REGEX);
  if (!match) return null;
  return `GHA-${match[1]}-${match[2]}`;
}

/**
 * Computes the check digit for a Ghana Card number.
 * Luhn-style algorithm used by NIA (simplified).
 */
export function computeCheckDigit(eightDigits: string): number {
  if (!/^\d{8}$/.test(eightDigits)) throw new Error('Expected 8 digits');
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const d = parseInt(eightDigits[i], 10);
    sum += i % 2 === 0 ? d * 2 > 9 ? d * 2 - 9 : d * 2 : d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validates the check digit of a Ghana Card number.
 */
export function validateCheckDigit(cardNumber: string): boolean {
  const match = cardNumber.match(/^GHA-(\d{8})-(\d)$/);
  if (!match) return false;
  const expected = computeCheckDigit(match[1]);
  return expected === parseInt(match[2], 10);
}

// ─── OCR Parsing ─────────────────────────────────────────────────────────────

/**
 * Parses structured data from OCR text of Ghana Card.
 * Handles both front and back of card.
 */
export function parseOcrText(ocrText: string): OcrExtractionResult {
  const text = ocrText.toUpperCase();
  let confidence = 0;
  const cardData: Partial<GhanaCardData> = {};

  // Card number
  const cardNumberMatch = text.match(/GHA[- ](\d{8})[- ](\d)/);
  if (cardNumberMatch) {
    cardData.cardNumber = `GHA-${cardNumberMatch[1]}-${cardNumberMatch[2]}`;
    confidence += 30;
  }

  // Date of birth (DD/MM/YYYY or DD-MM-YYYY)
  const dobMatch = text.match(/(?:DATE\s+OF\s+BIRTH|DOB)[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
  if (dobMatch) {
    cardData.dateOfBirth = dobMatch[1].replace(/-/g, '/');
    confidence += 15;
  }

  // Surname
  const surnameMatch = text.match(/SURNAME[:\s]+([A-Z\s]{2,30})/);
  if (surnameMatch) {
    cardData.surname = surnameMatch[1].trim();
    confidence += 10;
  }

  // Given names
  const givenNamesMatch = text.match(/(?:GIVEN\s+NAMES?|FIRST\s+NAME)[:\s]+([A-Z\s]{2,50})/);
  if (givenNamesMatch) {
    cardData.givenNames = givenNamesMatch[1].trim();
    confidence += 10;
  }

  // Sex
  const sexMatch = text.match(/(?:SEX|GENDER)[:\s]+([MF])/);
  if (sexMatch) {
    cardData.sex = sexMatch[1] as 'M' | 'F';
    confidence += 5;
  }

  // Expiry date
  const expiryMatch = text.match(/(?:EXPIRY|EXPIRES?|VALID\s+UNTIL)[:\s]+(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
  if (expiryMatch) {
    cardData.expiryDate = expiryMatch[1].replace(/-/g, '/');
    confidence += 10;
  }

  // Personal ID number (distinct from card number)
  const personalIdMatch = text.match(/(?:PERSONAL\s+ID|PIN)[:\s]+([A-Z0-9]+)/);
  if (personalIdMatch) {
    cardData.personalIdNumber = personalIdMatch[1];
    confidence += 10;
  }

  // MRZ (Machine Readable Zone — two lines at bottom)
  const mrzMatch = text.match(/([A-Z0-9<]{44})\n?([A-Z0-9<]{44})/);
  if (mrzMatch) {
    cardData.mrz = `${mrzMatch[1]}\n${mrzMatch[2]}`;
    confidence += 10;
  }

  const success = confidence >= 30;

  return {
    success,
    cardData: success ? cardData : undefined,
    confidence: Math.min(confidence, 100),
    rawText: ocrText,
    error: !success ? 'Insufficient data extracted from OCR' : undefined,
  };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CachedVerification {
  result: GhanaCardVerificationResult;
  cachedAt: number;
}

function getCachedVerification(cardNumber: string): GhanaCardVerificationResult | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${VERIFICATION_CACHE_KEY_PREFIX}${cardNumber}`);
    if (!raw) return null;
    const cached: CachedVerification = JSON.parse(raw);
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(`${VERIFICATION_CACHE_KEY_PREFIX}${cardNumber}`);
      return null;
    }
    return { ...cached.result, cached: true };
  } catch {
    return null;
  }
}

function setCachedVerification(cardNumber: string, result: GhanaCardVerificationResult): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const cached: CachedVerification = { result, cachedAt: Date.now() };
    localStorage.setItem(
      `${VERIFICATION_CACHE_KEY_PREFIX}${cardNumber}`,
      JSON.stringify(cached)
    );
  } catch {
    // Storage quota exceeded — ignore
  }
}

// ─── NIA API Verification ─────────────────────────────────────────────────────

export interface NiaVerificationOptions {
  cardNumber: string;
  dateOfBirth?: string;
  selfieImageBase64?: string;
  skipBiometric?: boolean;
  useCache?: boolean;
}

/**
 * Calls the NIA verification API via our backend proxy.
 * All NIA calls are routed through our backend to:
 * 1. Keep API keys server-side
 * 2. Log all verification attempts for audit
 * 3. Enforce data residency (responses stay in Ghana)
 */
export async function verifyGhanaCard(
  options: NiaVerificationOptions
): Promise<GhanaCardVerificationResult> {
  const normalized = normalizeCardNumber(options.cardNumber);

  // 1. Format check
  if (!validateGhanaCardFormat(normalized)) {
    return {
      valid: false,
      formatValid: false,
      niaVerified: null,
      biometricMatch: null,
      error: `Invalid Ghana Card format. Expected: GHA-XXXXXXXX-X`,
      errorCode: 'INVALID_FORMAT',
    };
  }

  // 2. Check digit validation
  if (!validateCheckDigit(normalized)) {
    return {
      valid: false,
      formatValid: false,
      niaVerified: null,
      biometricMatch: null,
      error: 'Ghana Card check digit invalid',
      errorCode: 'INVALID_FORMAT',
    };
  }

  // 3. Cache check (only for positive verifications)
  if (options.useCache !== false) {
    const cached = getCachedVerification(normalized);
    if (cached?.valid && cached.niaVerified) return cached;
  }

  // 4. NIA API call via backend proxy
  try {
    const body: Record<string, string | boolean> = {
      cardNumber: normalized,
      skipBiometric: options.skipBiometric ?? false,
    };
    if (options.dateOfBirth) body.dateOfBirth = options.dateOfBirth;
    if (options.selfieImageBase64 && !options.skipBiometric) {
      body.selfieImage = options.selfieImageBase64;
    }

    const response = await fetch('/api/kyc/nia-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      if (response.status === 503) {
        return {
          valid: false,
          formatValid: true,
          niaVerified: null,
          biometricMatch: null,
          error: 'NIA verification service temporarily unavailable',
          errorCode: 'NIA_API_UNAVAILABLE',
        };
      }
      const errData = await response.json().catch(() => ({})) as { code?: string };
      return {
        valid: false,
        formatValid: true,
        niaVerified: false,
        biometricMatch: null,
        error: errData.code ?? 'NIA verification failed',
        errorCode: errData.code as GhanaCardVerificationResult['errorCode'] ?? 'NIA_NOT_FOUND',
      };
    }

    const data = await response.json() as {
      found: boolean;
      biometricMatch?: boolean;
      expired?: boolean;
      cardData?: GhanaCardData;
    };

    const result: GhanaCardVerificationResult = {
      valid: data.found && !data.expired,
      formatValid: true,
      niaVerified: data.found,
      biometricMatch: data.biometricMatch ?? null,
      extractedData: data.cardData,
      verifiedAt: new Date().toISOString(),
      cached: false,
      ...(data.expired && { error: 'Ghana Card has expired', errorCode: 'NIA_EXPIRED' }),
      ...(!data.found && { error: 'Card not found in NIA database', errorCode: 'NIA_NOT_FOUND' }),
      ...(data.biometricMatch === false && {
        error: 'Biometric match failed',
        errorCode: 'NIA_BIOMETRIC_MISMATCH',
      }),
    };

    // Cache successful verifications for 24h
    if (result.valid) setCachedVerification(normalized, result);

    return result;
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    return {
      valid: false,
      formatValid: true,
      niaVerified: null,
      biometricMatch: null,
      error: isTimeout ? 'NIA verification timed out' : 'Network error during verification',
      errorCode: 'NETWORK_ERROR',
    };
  }
}

// ─── Liveness Check ───────────────────────────────────────────────────────────

export interface LivenessCheckResult {
  passed: boolean;
  score: number; // 0-1
  challenge?: string;
  error?: string;
}

/**
 * Submits a selfie for liveness detection before biometric matching.
 * Uses our backend which calls the liveness detection service.
 */
export async function checkLiveness(
  selfieBase64: string
): Promise<LivenessCheckResult> {
  try {
    const res = await fetch('/api/kyc/liveness-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: selfieBase64 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { passed: false, score: 0, error: 'Liveness check service error' };
    }
    return res.json() as Promise<LivenessCheckResult>;
  } catch {
    return { passed: false, score: 0, error: 'Liveness check failed' };
  }
}
