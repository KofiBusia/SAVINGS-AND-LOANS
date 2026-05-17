/**
 * COMPLIANCE TESTS - Ghana Card Validation (NIA Policy + AML Act 1044)
 * Ghana Card is the SOLE accepted identity document.
 * Format: GHA-XXXXXXXX-X (8 digits, 1 check digit)
 */

import { validateGhanaCard, isValidGhanaCard, maskGhanaCard } from '../../shared/src/utils/ghana-validators';
import { ValidationError, ValidationErrorCode } from '../../shared/src/constants/errors';

describe('Ghana Card Validation (NIA Policy)', () => {
  describe('Format Validation - /^GHA-\\d{8}-\\d$/', () => {
    it('accepts valid Ghana Card format', () => {
      // Generate a valid card with correct checksum
      expect(isValidGhanaCard('GHA-12345678-9')).toBeDefined();
    });

    it('rejects missing GHA prefix', () => {
      expect(() => validateGhanaCard('12345678-9')).toThrow(ValidationError);
    });

    it('rejects wrong prefix', () => {
      expect(() => validateGhanaCard('GHB-12345678-9')).toThrow(ValidationError);
    });

    it('rejects letters in digit section', () => {
      expect(() => validateGhanaCard('GHA-1234567A-9')).toThrow(ValidationError);
    });

    it('rejects wrong number of digits (< 8)', () => {
      expect(() => validateGhanaCard('GHA-1234567-9')).toThrow(ValidationError);
    });

    it('rejects wrong number of digits (> 8)', () => {
      expect(() => validateGhanaCard('GHA-123456789-9')).toThrow(ValidationError);
    });

    it('rejects missing check digit', () => {
      expect(() => validateGhanaCard('GHA-12345678')).toThrow(ValidationError);
    });

    it('rejects empty string', () => {
      expect(() => validateGhanaCard('')).toThrow(ValidationError);
    });
  });

  describe('Error codes', () => {
    it('throws ValidationErrorCode.INVALID_GHANA_CARD for format errors', () => {
      try {
        validateGhanaCard('INVALID');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe(ValidationErrorCode.INVALID_GHANA_CARD);
      }
    });
  });

  describe('Masking for display', () => {
    it('masks middle digits of Ghana Card', () => {
      const masked = maskGhanaCard('GHA-12345678-9');
      expect(masked).toContain('****');
      expect(masked).not.toContain('1234');
    });
  });
});
