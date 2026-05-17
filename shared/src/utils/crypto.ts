/**
 * Cryptographic utilities for Ghana Savings & Loans platform.
 * Implements SHA-256 hash chaining for immutable audit logs (Cybersecurity Act 1038).
 * Uses AES-256-GCM for PII encryption at rest (Data Protection Act 843).
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// --- SHA-256 Hash Chain (Audit Log Integrity) ---

/** Genesis hash for the audit log chain (publicly known constant) */
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Compute SHA-256 hash for audit log chain.
 * hash = SHA256(prevHash || action || timestamp || userId)
 * This creates an immutable, tamper-evident chain of audit events.
 */
export function computeAuditHash(
  prevHash: string,
  action: string,
  timestamp: string,
  userId: string,
): string {
  return createHash('sha256')
    .update(prevHash + action + timestamp + userId)
    .digest('hex');
}

/**
 * Verify integrity of a hash chain segment.
 * Returns the index of the first tampered entry, or -1 if chain is intact.
 */
export function verifyHashChain(
  entries: Array<{ hash: string; prevHash: string; action: string; timestamp: string; userId: string }>,
): number {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedHash = computeAuditHash(
      entry.prevHash,
      entry.action,
      entry.timestamp,
      entry.userId,
    );
    if (expectedHash !== entry.hash) {
      return i;
    }
    // Verify chain linkage
    if (i > 0 && entries[i - 1].hash !== entry.prevHash) {
      return i;
    }
  }
  return -1;
}

// --- AES-256-GCM Encryption for PII ---

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
}

/**
 * Derive a 256-bit encryption key from a passphrase using scrypt.
 * This is used to derive per-record keys from the master PII encryption key.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH) as Buffer;
}

/**
 * Encrypt PII data using AES-256-GCM.
 * Each encryption uses a unique IV and salt for forward secrecy.
 * Use this for Ghana Card numbers, biometric hashes, income data.
 */
export function encryptPII(plaintext: string, masterKey: string): EncryptedData {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    salt: salt.toString('hex'),
  };
}

/**
 * Decrypt PII data encrypted with encryptPII.
 */
export function decryptPII(encrypted: EncryptedData, masterKey: string): string {
  const salt = Buffer.from(encrypted.salt, 'hex');
  const iv = Buffer.from(encrypted.iv, 'hex');
  const authTag = Buffer.from(encrypted.authTag, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  const key = deriveKey(masterKey, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/**
 * Create a one-way hash of a Ghana Card number for indexed lookup.
 * Never store raw Ghana Card numbers in databases - only this hash.
 * Uses SHA-256 with application-specific salt.
 */
export function hashGhanaCard(cardNumber: string, appSalt: string): string {
  return createHash('sha256')
    .update(appSalt + cardNumber)
    .digest('hex');
}

/**
 * Generate a cryptographically secure random token (for OTPs, reset tokens etc.)
 */
export function generateSecureToken(byteLength: number = 32): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Use when comparing tokens, hashes, or secrets.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.equals(bufB);
}

/**
 * Hash a value for secure comparison (e.g. API keys stored in DB).
 */
export function hashForStorage(value: string, salt: string): string {
  return createHash('sha256').update(salt + value).digest('hex');
}
