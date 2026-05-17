import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  secret: string;
  refreshSecret: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
  issuer: string;
  audience: string;
  algorithm: 'RS256' | 'HS256';
  deviceBindingRequired: boolean;
  mfaClaimRequired: boolean;
}

export interface MfaConfig {
  totpIssuer: string;
  totpWindow: number;           // Number of 30-second windows to accept
  totpDigits: number;
  totpStep: number;             // Seconds per TOTP step
  backupCodeCount: number;
  backupCodeLength: number;
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  breakGlassRequiresDualApproval: boolean;
  breakGlassApproverRoles: string[];
  breakGlassAuditRequired: boolean;
  breakGlassMaxDurationMinutes: number;
}

export interface SessionConfig {
  secret: string;
  maxAge: number;               // Milliseconds
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  rolling: boolean;
  absoluteTimeoutMinutes: number;
  idleTimeoutMinutes: number;
  maxConcurrentSessions: number;
  adminIdleTimeoutMinutes: number;
}

export interface DataResidencyConfig {
  allowedCountries: string[];   // ISO-3166-1 alpha-2
  primaryRegion: string;
  backupRegion: string;
  piiExportBlocked: boolean;
  piiExportAllowedJurisdictions: string[];
  dataClassifications: {
    publicData: string[];
    internalData: string[];
    confidentialData: string[];
    restrictedData: string[];   // PII, financial data — Ghana-only
  };
  crossBorderTransferBasis: string;  // Legal basis for any cross-border transfer
  dataResidencyEnforcedAt: string;
}

export interface RateLimitConfig {
  global: {
    ttl: number;
    limit: number;
  };
  auth: {
    ttl: number;
    limit: number;
  };
  mfa: {
    ttl: number;
    limit: number;
  };
  sensitive: {
    ttl: number;
    limit: number;
  };
}

export interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  saltRounds: number;           // bcrypt rounds
  fieldEncryptionKey: string;   // For encrypting PII fields at rest
  kmsKeyId: string;             // If using a KMS
}

export interface SecurityConfig {
  jwt: JwtConfig;
  mfa: MfaConfig;
  session: SessionConfig;
  dataResidency: DataResidencyConfig;
  rateLimit: RateLimitConfig;
  encryption: EncryptionConfig;
  deviceBinding: {
    required: boolean;
    maxDevicesPerUser: number;
    deviceExpiryDays: number;
    trustDurationDays: number;
    fingerprintFields: string[];
  };
  passwordPolicy: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    maxAge: number;             // Days before forced reset
    historyCount: number;       // Cannot reuse last N passwords
    commonPasswordsBlocked: boolean;
  };
  auditRetentionYears: number;  // Minimum 7 years per BoG
  loanRecordRetentionYears: number; // 10 years per Credit Reporting Act
}

export default registerAs('security', (): SecurityConfig => ({
  // ─── JWT Configuration ────────────────────────────────────────────────────────
  jwt: {
    secret: process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET env var is required'); })(),
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? (() => { throw new Error('JWT_REFRESH_SECRET env var is required'); })(),
    accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES ?? '15m',
    refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES ?? '7d',
    issuer: process.env.JWT_ISSUER ?? 'ghana-sl-backoffice',
    audience: process.env.JWT_AUDIENCE ?? 'ghana-sl-api',
    algorithm: 'HS256',
    deviceBindingRequired: true,
    mfaClaimRequired: true,
  },

  // ─── MFA / TOTP Configuration ─────────────────────────────────────────────────
  mfa: {
    totpIssuer: 'Ghana S&L Back-Office',
    totpWindow: 1,              // ±1 window = 90 seconds tolerance
    totpDigits: 6,
    totpStep: 30,               // 30-second TOTP step
    backupCodeCount: 10,
    backupCodeLength: 10,       // 10-character alphanumeric codes
    maxFailedAttempts: 5,
    lockoutDurationMinutes: 30,
    breakGlassRequiresDualApproval: true,
    breakGlassApproverRoles: ['SUPER_ADMIN', 'COMPLIANCE_OFFICER'],
    breakGlassAuditRequired: true,
    breakGlassMaxDurationMinutes: 60,
  },

  // ─── Session Configuration ────────────────────────────────────────────────────
  session: {
    secret: process.env.SESSION_SECRET ?? (() => { throw new Error('SESSION_SECRET env var is required'); })(),
    maxAge: 8 * 60 * 60 * 1000, // 8 hours max
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    rolling: true,              // Extend session on activity
    absoluteTimeoutMinutes: 480, // 8 hours absolute
    idleTimeoutMinutes: 30,
    maxConcurrentSessions: 3,
    adminIdleTimeoutMinutes: 15, // Stricter for admin roles
  },

  // ─── Data Residency Rules (DPA 2012) ─────────────────────────────────────────
  dataResidency: {
    allowedCountries: ['GH'],   // Ghana ONLY for PII
    primaryRegion: 'af-south-1-gh', // Ghana data centre
    backupRegion: 'af-south-1-gh-dr', // Ghana DR site
    piiExportBlocked: true,
    piiExportAllowedJurisdictions: [], // No exceptions by default
    dataClassifications: {
      publicData: ['product_names', 'interest_rates', 'branch_locations'],
      internalData: ['transaction_aggregates', 'portfolio_stats'],
      confidentialData: ['customer_accounts', 'loan_details', 'financial_summaries'],
      restrictedData: [  // Must NEVER leave Ghana
        'ghana_card_numbers',
        'biometric_data',
        'national_id_hashes',
        'income_information',
        'credit_scores',
        'pep_status',
        'aml_risk_scores',
        'beneficial_ownership_records',
      ],
    },
    crossBorderTransferBasis: 'PROHIBITED — DPA 2012 Section 35(1): No transfer to country without adequate protection',
    dataResidencyEnforcedAt: 'APPLICATION_LAYER',
  },

  // ─── Rate Limiting ────────────────────────────────────────────────────────────
  rateLimit: {
    global: {
      ttl: 60000,   // 1 minute window
      limit: 100,   // 100 requests per minute per IP
    },
    auth: {
      ttl: 60000,
      limit: 20,    // 20 auth attempts per minute
    },
    mfa: {
      ttl: 300000,  // 5 minute window
      limit: 10,    // 10 MFA attempts per 5 minutes
    },
    sensitive: {
      ttl: 3600000, // 1 hour window
      limit: 50,    // 50 sensitive ops per hour
    },
  },

  // ─── Encryption ───────────────────────────────────────────────────────────────
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    saltRounds: 12,             // bcrypt rounds for passwords
    fieldEncryptionKey: process.env.FIELD_ENCRYPTION_KEY ?? '',
    kmsKeyId: process.env.KMS_KEY_ID ?? '',
  },

  // ─── Device Binding ───────────────────────────────────────────────────────────
  deviceBinding: {
    required: true,
    maxDevicesPerUser: 5,
    deviceExpiryDays: 90,       // Re-authenticate after 90 days
    trustDurationDays: 30,      // Trust for 30 days before step-up
    fingerprintFields: [
      'userAgent',
      'ipAddress',
      'timezone',
      'screenResolution',
      'platform',
      'language',
    ],
  },

  // ─── Password Policy ──────────────────────────────────────────────────────────
  passwordPolicy: {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAge: 90,                 // Force reset every 90 days
    historyCount: 12,           // Cannot reuse last 12 passwords
    commonPasswordsBlocked: true,
  },

  // ─── Record Retention ─────────────────────────────────────────────────────────
  auditRetentionYears: 7,       // BoG minimum
  loanRecordRetentionYears: 10, // Credit Reporting Act 2007
}));
