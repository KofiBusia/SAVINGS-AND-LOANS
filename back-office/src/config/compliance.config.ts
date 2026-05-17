import { registerAs } from '@nestjs/config';

export interface DigitalCreditDirectiveParams {
  effectiveDate: string;
  interestType: 'SIMPLE_ONLY';
  compoundingProhibited: true;
  maxAPRPercent: number;
  transparencyDisclosureRequired: boolean;
  preAgreementDisplayRequired: boolean;
  coolingOffPeriodDays: number;
  earlyRepaymentPenaltyMaxPercent: number;
  restructuringBoGApprovalRequired: boolean;
  restructuringMaxFrequency: number;       // Times per loan lifetime
  creditLifeInsuranceRequired: boolean;
  totalCostOfCreditDisclosure: boolean;
  digitalSignatureRequired: boolean;
}

export interface AMLThresholds {
  cashTransactionReportGHS: number;        // CTR threshold
  suspiciousTransactionReportGHS: number;  // STR threshold
  pepScreeningMandatory: boolean;
  uboDisclosureThresholdPercent: number;   // 25% per AML Act 1044
  kycRiskBands: {
    low: { maxScore: number; refreshDays: number };
    medium: { maxScore: number; refreshDays: number };
    high: { maxScore: number; refreshDays: number };
    veryHigh: { maxScore: number; refreshDays: number };
  };
  sanctionedCountries: string[];           // ISO-3166-1 alpha-2
  highRiskCountries: string[];             // FATF grey/black list
  eddTriggers: string[];
  transactionMonitoringRules: {
    rapidSuccessiveTransactions: {
      count: number;
      windowMinutes: number;
    };
    unusualPatternThresholdMultiplier: number; // e.g. 3x monthly average
    newAccountHighValueDays: number;          // Days after account opening to flag high value
    newAccountHighValueThresholdGHS: number;
  };
}

export interface KycDocumentRequirements {
  primaryIdentityDocuments: string[];
  supportingDocuments: string[];
  addressProofDocuments: string[];
  incomeProofDocuments: string[];
  businessDocuments: string[];
  highRiskAdditionalDocuments: string[];
  pepDocuments: string[];
  documentValidityPeriodDays: {
    ghanaCard: number;
    passport: number;
    votersId: number;
    driversLicense: number;
    utilityBill: number;
    bankStatement: number;
  };
}

export interface ReportingSchedules {
  daily: {
    portfolioSummary: { hour: number; minute: number };
    amlTransactionMonitoring: { hour: number; minute: number };
    liquidityReport: { hour: number; minute: number };
  };
  monthly: {
    bogPrudentialReturn: { businessDayOfMonth: number };
    creditConcentration: { businessDayOfMonth: number };
    interestRateSurvey: { businessDayOfMonth: number };
    customerComplaintsLog: { businessDayOfMonth: number };
  };
  quarterly: {
    bogCapitalAdequacy: { businessDayAfterQuarterEnd: number };
    ficAmlReport: { businessDayAfterQuarterEnd: number };
    npaClassification: { businessDayAfterQuarterEnd: number };
  };
  annual: {
    auditedFinancialStatements: { monthsAfterYearEnd: number };
    kycBulkRefresh: { month: number };
    dpaDsarAudit: { month: number };
  };
}

export interface ComplianceConfig {
  digitalCreditDirective2025: DigitalCreditDirectiveParams;
  aml: AMLThresholds;
  kyc: KycDocumentRequirements;
  reporting: ReportingSchedules;
  npaClassification: {
    watchlistDaysOverdue: number;
    substandardDaysOverdue: number;
    doubtfulDaysOverdue: number;
    lossClassificationDaysOverdue: number;
    provisionRates: {
      performing: number;
      watchlist: number;
      substandard: number;
      doubtful: number;
      loss: number;
    };
  };
  capitalAdequacy: {
    minimumCapitalAdequacyRatio: number;
    tier1CapitalRatio: number;
    liquidityCoverageRatio: number;
  };
}

export default registerAs('compliance', (): ComplianceConfig => ({

  // ─── BoG Digital Credit Directive 2025 ───────────────────────────────────────
  digitalCreditDirective2025: {
    effectiveDate: '2025-01-01',
    interestType: 'SIMPLE_ONLY',
    compoundingProhibited: true,
    maxAPRPercent: 36,
    transparencyDisclosureRequired: true,
    preAgreementDisplayRequired: true,
    coolingOffPeriodDays: 3,          // 3-day cooling off period
    earlyRepaymentPenaltyMaxPercent: 3, // Max 3% prepayment penalty
    restructuringBoGApprovalRequired: true,
    restructuringMaxFrequency: 2,      // Max 2 restructurings per loan
    creditLifeInsuranceRequired: true,
    totalCostOfCreditDisclosure: true,
    digitalSignatureRequired: true,
  },

  // ─── AML Act 1044 Thresholds ──────────────────────────────────────────────────
  aml: {
    cashTransactionReportGHS: 10000,
    suspiciousTransactionReportGHS: 5000,
    pepScreeningMandatory: true,
    uboDisclosureThresholdPercent: 25,
    kycRiskBands: {
      low:      { maxScore: 30,  refreshDays: 365 },
      medium:   { maxScore: 60,  refreshDays: 180 },
      high:     { maxScore: 80,  refreshDays: 90  },
      veryHigh: { maxScore: 100, refreshDays: 30  },
    },
    // FATF-designated high-risk jurisdictions (updated per FATF list)
    sanctionedCountries: ['KP', 'IR', 'MM'],  // North Korea, Iran, Myanmar
    highRiskCountries: [
      'AF', 'AL', 'BB', 'BF', 'CM', 'CF', 'CD', 'GY', 'HT', 'JM',
      'LY', 'ML', 'MZ', 'NI', 'NG', 'PK', 'PH', 'PA', 'RU', 'SN',
      'SS', 'SY', 'TZ', 'TT', 'UG', 'AE', 'VN', 'YE',
    ],
    eddTriggers: [
      'PEP_STATUS',
      'HIGH_RISK_COUNTRY',
      'CASH_INTENSIVE_BUSINESS',
      'COMPLEX_CORPORATE_STRUCTURE',
      'ADVERSE_MEDIA',
      'SANCTIONS_MATCH',
      'UNUSUAL_TRANSACTION_PATTERN',
      'INCONSISTENT_INCOME',
      'HIGH_RISK_OCCUPATION',
      'PRIOR_STR_FILED',
    ],
    transactionMonitoringRules: {
      rapidSuccessiveTransactions: {
        count: 5,
        windowMinutes: 60,      // 5 transactions within 60 minutes
      },
      unusualPatternThresholdMultiplier: 3, // 3x average monthly activity
      newAccountHighValueDays: 30,
      newAccountHighValueThresholdGHS: 5000,
    },
  },

  // ─── KYC Document Requirements ────────────────────────────────────────────────
  kyc: {
    primaryIdentityDocuments: [
      'GHANA_CARD',             // Preferred — NIA biometric
      'PASSPORT',
      'VOTERS_ID',
      'DRIVERS_LICENSE',
    ],
    supportingDocuments: [
      'BIRTH_CERTIFICATE',
      'MARRIAGE_CERTIFICATE',
      'NHIS_CARD',
    ],
    addressProofDocuments: [
      'UTILITY_BILL_LAST_3_MONTHS',
      'BANK_STATEMENT_LAST_3_MONTHS',
      'LANDLORD_REFERENCE_LETTER',
      'PROPERTY_RATE_RECEIPT',
      'GHANA_POST_GPS_ADDRESS',
    ],
    incomeProofDocuments: [
      'PAYSLIP_LAST_3_MONTHS',
      'EMPLOYMENT_LETTER',
      'AUDITED_ACCOUNTS',       // For self-employed
      'TAX_CLEARANCE_CERTIFICATE',
      'PENSION_STATEMENT',
      'BUSINESS_REGISTRATION',
    ],
    businessDocuments: [
      'CERTIFICATE_OF_INCORPORATION',
      'FORM_3_DIRECTORS',
      'TAX_IDENTIFICATION_NUMBER',
      'AUDITED_ACCOUNTS_2_YEARS',
      'MEMORANDUM_ARTICLES_ASSOCIATION',
    ],
    highRiskAdditionalDocuments: [
      'SOURCE_OF_FUNDS_DECLARATION',
      'SOURCE_OF_WEALTH_DECLARATION',
      'ENHANCED_REFERENCE_CHECKS',
      'SITE_VISIT_REPORT',
    ],
    pepDocuments: [
      'PEP_DECLARATION_FORM',
      'SOURCE_OF_WEALTH_DECLARATION',
      'ANNUAL_INCOME_DECLARATION',
    ],
    documentValidityPeriodDays: {
      ghanaCard: 3650,          // 10 years
      passport: 3650,
      votersId: 1825,           // 5 years
      driversLicense: 1825,
      utilityBill: 90,          // Must be within 3 months
      bankStatement: 90,
    },
  },

  // ─── Regulatory Reporting Schedules ──────────────────────────────────────────
  reporting: {
    daily: {
      portfolioSummary: { hour: 23, minute: 30 },
      amlTransactionMonitoring: { hour: 22, minute: 0 },
      liquidityReport: { hour: 17, minute: 0 },
    },
    monthly: {
      bogPrudentialReturn:   { businessDayOfMonth: 10 },
      creditConcentration:   { businessDayOfMonth: 10 },
      interestRateSurvey:    { businessDayOfMonth: 5  },
      customerComplaintsLog: { businessDayOfMonth: 7  },
    },
    quarterly: {
      bogCapitalAdequacy:          { businessDayAfterQuarterEnd: 15 },
      ficAmlReport:                { businessDayAfterQuarterEnd: 10 },
      npaClassification:           { businessDayAfterQuarterEnd: 10 },
    },
    annual: {
      auditedFinancialStatements: { monthsAfterYearEnd: 3 },
      kycBulkRefresh:             { month: 1 },   // January
      dpaDsarAudit:               { month: 6 },   // June
    },
  },

  // ─── NPA Classification per BoG ───────────────────────────────────────────────
  npaClassification: {
    watchlistDaysOverdue: 30,
    substandardDaysOverdue: 90,
    doubtfulDaysOverdue: 180,
    lossClassificationDaysOverdue: 360,
    provisionRates: {
      performing:   0.01,   // 1%
      watchlist:    0.03,   // 3%
      substandard:  0.20,   // 20%
      doubtful:     0.50,   // 50%
      loss:         1.00,   // 100%
    },
  },

  // ─── Capital Adequacy (BoG minimum requirements) ──────────────────────────────
  capitalAdequacy: {
    minimumCapitalAdequacyRatio: 0.10,   // 10% minimum CAR
    tier1CapitalRatio: 0.08,             // 8% Tier 1
    liquidityCoverageRatio: 1.00,        // 100% LCR
  },
}));
