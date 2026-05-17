/**
 * Ghana-specific validators enforcing NIA Ghana Card policy and other regulatory requirements.
 * Ghana Card is the SOLE financial identifier per NIA policy and AML Act 1044.
 */

import { ValidationError, ValidationErrorCode } from '../constants/errors';
import { GHANA_PHONE_REGEX, GHANA_MNO, normalizeGhanaPhone } from '../constants/ghana';

// NIA Ghana Card format: GHA-XXXXXXXX-X (8 digits, 1 check digit)
export const GHANA_CARD_REGEX = /^GHA-\d{8}-\d$/;

/**
 * Compute Luhn-style check digit for Ghana Card.
 * The NIA uses a weighted sum algorithm over the 8 numeric digits.
 */
function computeGhanaCardCheckDigit(digits: string): number {
  // Weights alternate 2,1 from right to left (Luhn variant)
  const weights = [2, 1, 2, 1, 2, 1, 2, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let product = parseInt(digits[i], 10) * weights[i];
    if (product > 9) product -= 9;
    sum += product;
  }
  const check = (10 - (sum % 10)) % 10;
  return check;
}

/**
 * Validate Ghana Card number format and checksum.
 * Format: GHA-XXXXXXXX-X where X are digits and the last X is the check digit.
 * Throws ValidationError if invalid.
 */
export function validateGhanaCard(cardNumber: string): {
  valid: true;
  digits: string;
  checkDigit: number;
} {
  if (!GHANA_CARD_REGEX.test(cardNumber)) {
    throw new ValidationError(
      ValidationErrorCode.INVALID_GHANA_CARD,
      `Ghana Card must match format GHA-XXXXXXXX-X (e.g. GHA-12345678-9). Got: ${cardNumber}`,
      'cardNumber',
    );
  }

  const parts = cardNumber.split('-');
  const digits = parts[1];
  const providedCheck = parseInt(parts[2], 10);
  const expectedCheck = computeGhanaCardCheckDigit(digits);

  if (providedCheck !== expectedCheck) {
    throw new ValidationError(
      ValidationErrorCode.INVALID_GHANA_CARD,
      `Ghana Card check digit invalid. Expected ${expectedCheck}, got ${providedCheck}.`,
      'cardNumber',
    );
  }

  return { valid: true, digits, checkDigit: expectedCheck };
}

/** Returns true if Ghana Card is valid format and checksum, false otherwise */
export function isValidGhanaCard(cardNumber: string): boolean {
  try {
    validateGhanaCard(cardNumber);
    return true;
  } catch {
    return false;
  }
}

/** Mask Ghana Card for display (e.g. GHA-****5678-9) */
export function maskGhanaCard(cardNumber: string): string {
  if (!GHANA_CARD_REGEX.test(cardNumber)) return '***-INVALID-*';
  const parts = cardNumber.split('-');
  return `GHA-****${parts[1].slice(4)}-${parts[2]}`;
}

/** Validate Ghana phone number */
export function validateGhanaPhone(phone: string): string {
  try {
    const normalized = normalizeGhanaPhone(phone);
    if (!GHANA_PHONE_REGEX.test(normalized.replace('+233', '0'))) {
      throw new Error();
    }
    return normalized;
  } catch {
    throw new ValidationError(
      ValidationErrorCode.INVALID_PHONE_NUMBER,
      `Invalid Ghana phone number: ${phone}. Expected format: 024XXXXXXX or +233XXXXXXXXX`,
      'phone',
    );
  }
}

/** Validate GhanaPost GPS address format (e.g. GA-123-4567) */
export function validateGhanaPostGPS(address: string): boolean {
  const GPS_REGEX = /^[A-Z]{2}-\d{3,4}-\d{4,5}$/;
  if (!GPS_REGEX.test(address)) {
    throw new ValidationError(
      ValidationErrorCode.INVALID_GHANA_POST_GPS,
      `Invalid GhanaPost GPS address: ${address}. Expected format: XX-NNN-NNNN`,
      'ghanaPostGPS',
    );
  }
  return true;
}

/** Validate loan amount is within regulatory bounds */
export function validateLoanAmount(amount: number, maxAmount: number = 100_000): void {
  if (amount <= 0) {
    throw new ValidationError(ValidationErrorCode.INVALID_AMOUNT, 'Loan amount must be positive');
  }
  if (!Number.isFinite(amount)) {
    throw new ValidationError(ValidationErrorCode.INVALID_AMOUNT, 'Loan amount must be a finite number');
  }
  if (amount > maxAmount) {
    throw new ValidationError(
      ValidationErrorCode.INVALID_AMOUNT,
      `Loan amount GH₵${amount} exceeds maximum GH₵${maxAmount} for this product`,
    );
  }
}

/** Validate loan term in months */
export function validateLoanTerm(termMonths: number, minMonths = 1, maxMonths = 60): void {
  if (!Number.isInteger(termMonths) || termMonths < minMonths || termMonths > maxMonths) {
    throw new ValidationError(
      ValidationErrorCode.INVALID_LOAN_TERM,
      `Loan term must be between ${minMonths} and ${maxMonths} months. Got: ${termMonths}`,
    );
  }
}

/** Check if phone number belongs to known Ghana MNO */
export function identifyMNO(phone: string): string | null {
  try {
    const normalized = normalizeGhanaPhone(phone);
    const localPrefix = '0' + normalized.slice(4, 7);
    for (const [mno, config] of Object.entries(GHANA_MNO)) {
      if ((config.prefix as readonly string[]).some(p => localPrefix.startsWith(p))) {
        return mno;
      }
    }
  } catch {
    // invalid number
  }
  return null;
}
