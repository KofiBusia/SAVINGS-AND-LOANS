/**
 * Regulatory Report interfaces for Ghana Savings & Loan Platform
 *
 * Regulatory references:
 *   - BoG Reporting Guidelines for MFIs 2023 (monthly returns)
 *   - FIC Annual Compliance Reporting Requirements 2021
 *   - Data Protection Commission Annual Report Requirements 2023
 *   - Credit Reporting Act 2007 (Act 726) — credit bureau reporting
 *   - BoG Prudential Norms for MFIs 2023 (NPL provisioning report)
 *
 * All reports must be generated from the read replica database
 * to avoid impacting transactional workloads.
 *
 * Report generation uses Makefile target: make bog-report MONTH=YYYY-MM
 */

// ============================================================================
// Common types
// ============================================================================

/** Report status in the filing workflow */
export enum ReportStatus {
  /** Report generated but not yet reviewed */
  DRAFT = 'DRAFT',
  /** Under internal review (compliance officer / CFO) */
  UNDER_REVIEW = 'UNDER_REVIEW',
  /** Approved internally; ready for submission */
  APPROVED = 'APPROVED',
  /** Submitted to regulator */
  SUBMITTED = 'SUBMITTED',
  /** Regulator confirmed receipt */
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  /** Regulator raised queries — awaiting response */
  QUERY_RECEIVED = 'QUERY_RECEIVED',
  /** All queries resolved; report accepted */
  ACCEPTED = 'ACCEPTED',
  /** Report rejected by regulator — must be corrected and resubmitted */
  REJECTED = 'REJECTED',
}

/** Common metadata attached to every regulatory report */
export interface ReportMetadata {
  id: string;
  /** Human-readable report reference: GSL-{REGULATOR}-{PERIOD}-{SEQUENCE} */
  reportRef: string;
  status: ReportStatus;
  /** ISO 8601 date/time report was generated */
  generatedAt: string;
  /** Staff ID who generated the report */
  generatedBy: string;
  /** ISO 8601 date/time report was approved internally */
  approvedAt: string | null;
  approvedBy: string | null;
  /** ISO 8601 date/time report was submitted to regulator */
  submittedAt: string | null;
  submittedBy: string | null;
  /** Regulatory portal submission reference */
  submissionRef: string | null;
  /** ISO 8601 deadline for submission */
  submissionDeadline: string;
  /** Whether submission is overdue */
  isOverdue: boolean;
  /** Institution BoG licence number */
  bogLicenceNumber: string;
  /** Institution name as registered with BoG */
  institutionName: string;
  /** SHA-256 hash of the report content (for tamper detection) */
  contentHash: string;
  /** File path of the generated report (XLSX/PDF) */
  filePath: string | null;
}

// ============================================================================
// Bank of Ghana (BoG) Monthly Return
// ============================================================================

/**
 * BoG Monthly Return — primary regulatory submission
 * Due: Within 15 days of month-end
 *
 * @see BoG Reporting Guidelines for MFIs 2023
 * @see BoG Prudential Norms for MFIs 2023
 *
 * Forms:
 *   - Form A: Balance Sheet (Assets, Liabilities, Equity)
 *   - Form B: Profit & Loss Statement
 *   - Form C: Loan Portfolio Quality Report
 *   - Form D: Capital Adequacy Report
 *   - Form E: Liquidity Report
 */
export interface BoGMonthlyReturn {
  metadata: ReportMetadata;

  /** Reporting period: first day of the month (ISO 8601 date) */
  reportingPeriodStart: string;
  /** Reporting period: last day of the month (ISO 8601 date) */
  reportingPeriodEnd: string;

  // --------------------------------------------------------------------------
  // Form A: Balance Sheet
  // --------------------------------------------------------------------------
  balanceSheet: {
    // Assets (GHS)
    cashAndBankBalancesGhs: number;
    investmentsGhs: number;
    grossLoanPortfolioGhs: number;
    loanLossProvisionGhs: number;
    netLoanPortfolioGhs: number;
    otherAssetsGhs: number;
    fixedAssetsGhs: number;
    totalAssetsGhs: number;

    // Liabilities (GHS)
    customerDepositsGhs: number;
    borrowingsGhs: number;
    otherLiabilitiesGhs: number;
    totalLiabilitiesGhs: number;

    // Equity (GHS)
    paidUpCapitalGhs: number;
    retainedEarningsGhs: number;
    currentPeriodProfitLossGhs: number;
    totalEquityGhs: number;

    totalLiabilitiesAndEquityGhs: number;
  };

  // --------------------------------------------------------------------------
  // Form B: Profit & Loss
  // --------------------------------------------------------------------------
  profitLoss: {
    // Income (GHS)
    interestIncomeGhs: number;
    processingFeeIncomeGhs: number;
    otherOperatingIncomeGhs: number;
    totalIncomeGhs: number;

    // Expenses (GHS)
    interestExpenseGhs: number;
    loanLossProvisionExpenseGhs: number;
    staffCostsGhs: number;
    otherOperatingExpensesGhs: number;
    totalExpensesGhs: number;

    netProfitLossGhs: number;
  };

  // --------------------------------------------------------------------------
  // Form C: Loan Portfolio Quality
  // --------------------------------------------------------------------------
  loanPortfolio: {
    /** Total number of active loan accounts */
    totalLoanAccounts: number;
    /** Gross loan portfolio (GHS) */
    grossPortfolioGhs: number;

    /** Loans by age of arrears — BoG standard PAR buckets */
    par0to30DaysGhs: number;   // Current
    par31to60DaysGhs: number;
    par61to90DaysGhs: number;
    par91to180DaysGhs: number;
    par181plusDaysGhs: number;

    /**
     * Portfolio at Risk > 30 days (PAR30) — key BoG indicator
     * Target: < 5% (BoG Prudential Norms)
     */
    par30Percent: number;

    /**
     * Non-Performing Loan ratio (NPL = PAR90+)
     * Target: < 10% (BoG prudential limit)
     */
    nplPercent: number;

    /** Loans restructured this period */
    restructuredLoansCount: number;
    restructuredLoansGhs: number;

    /** Loans written off this period */
    writtenOffCount: number;
    writtenOffGhs: number;

    /** Loan disbursements this period */
    disbursementsCount: number;
    disbursementsGhs: number;

    /** Loan repayments received this period */
    repaymentsGhs: number;

    /** Loan loss provision adequacy */
    loanLossProvisionGhs: number;
    provisionCoveragePercent: number;
  };

  // --------------------------------------------------------------------------
  // Form D: Capital Adequacy
  // --------------------------------------------------------------------------
  capitalAdequacy: {
    /**
     * Tier 1 Capital (Core Capital)
     * BoG minimum: GHS 2,000,000 for Tier 2 MFI
     */
    tier1CapitalGhs: number;
    tier2CapitalGhs: number;
    totalCapitalGhs: number;

    /** Risk-Weighted Assets */
    riskWeightedAssetsGhs: number;

    /**
     * Capital Adequacy Ratio (CAR) = Total Capital / RWA × 100
     * BoG minimum: 10%
     */
    capitalAdequacyRatioPercent: number;

    meetsMinimumCapitalRequirement: boolean;
  };

  // --------------------------------------------------------------------------
  // Form E: Liquidity
  // --------------------------------------------------------------------------
  liquidity: {
    /**
     * Liquidity Ratio = Liquid Assets / Total Deposits × 100
     * BoG minimum: 15%
     */
    liquidityRatioPercent: number;
    liquidAssetsGhs: number;
    totalDepositsGhs: number;
    meetsLiquidityRequirement: boolean;
  };

  // --------------------------------------------------------------------------
  // Deposit Statistics
  // --------------------------------------------------------------------------
  deposits: {
    totalDepositAccounts: number;
    newAccountsOpenedThisMonth: number;
    accountsClosedThisMonth: number;
    dormantAccountsCount: number;
    dormantAccountsGhs: number;
    fixedDepositsTotalGhs: number;
    savingsDepositsTotalGhs: number;
  };
}

// ============================================================================
// Financial Intelligence Centre (FIC) Reports
// ============================================================================

/**
 * Suspicious Transaction Report (STR)
 * @see FIC Act 2020 §34: Must be filed within 3 working days of suspicion
 *
 * CRITICAL: Filing deadline is non-negotiable. Failure to file is a
 * criminal offence (FIC Act 2020 §62). Automated system should trigger
 * workflow immediately upon suspicion.
 */
export interface SuspiciousTransactionReport {
  metadata: ReportMetadata;

  /** FIC form type: STR-1 (Individual) or STR-2 (Entity) */
  ficFormType: 'STR-1' | 'STR-2';

  /** ISO 8601 date transaction(s) occurred */
  transactionDate: string;

  /** ISO 8601 date suspicion arose */
  suspicionDate: string;

  /**
   * ISO 8601 DEADLINE for filing (3 working days from suspicion date)
   * System auto-escalates if 48 hours before deadline and not filed
   */
  filingDeadline: string;

  /** Customer involved */
  subjectCustomerId: string;
  subjectName: string;
  subjectGhanaCard: string;

  /** Transaction IDs involved */
  relatedTransactionIds: string[];

  /** Total amount involved (GHS) */
  totalAmountGhs: number;

  /**
   * Basis for suspicion (FIC Act 2020 §34 prescribed categories)
   */
  suspicionBasis: Array<
    | 'STRUCTURING'         // Transactions structured to avoid CTR threshold
    | 'UNUSUAL_PATTERN'     // Unusual transaction pattern for customer profile
    | 'INCONSISTENT_PURPOSE' // Transaction purpose inconsistent with business
    | 'CASH_INTENSIVE'      // Unexplained large cash activity
    | 'RAPID_MOVEMENT'      // Funds rapidly moved in and out
    | 'PEP_TRANSACTION'     // Transaction involving PEP
    | 'SANCTION_RISK'       // Connection to sanctioned individual/entity
    | 'FRAUD_SUSPECTED'     // Suspected fraud
    | 'OTHER'               // Other — must include narrative
  >;

  /** Detailed narrative description of the suspicious activity */
  suspicionNarrative: string;

  /** Whether the customer was notified (must NOT be notified per FIC Act §35) */
  customerNotified: boolean; // Must always be false — tipping off is illegal

  /**
   * Staff who raised the suspicion
   */
  raisedBy: string;
  raisedAt: string;

  /** Compliance officer who reviewed and approved for filing */
  reviewedBy: string | null;
  reviewedAt: string | null;

  /** FIC acknowledgement reference */
  ficAcknowledgementRef: string | null;
  ficAcknowledgedAt: string | null;
}

/**
 * Currency Transaction Report (CTR)
 * @see FIC Act 2020 §33: Required for cash transactions >= GHS 10,000
 * Filing deadline: Within 2 working days
 */
export interface CurrencyTransactionReport {
  metadata: ReportMetadata;

  /** Transaction ID that triggered this CTR */
  transactionId: string;

  /** ISO 8601 date of the cash transaction */
  transactionDate: string;

  /** Amount of cash transaction (GHS) — must be >= GHS 10,000 */
  amountGhs: number;

  /** Whether deposit or withdrawal */
  transactionDirection: 'CASH_IN' | 'CASH_OUT';

  /** Customer who made the transaction */
  customerId: string;
  customerName: string;
  customerGhanaCard: string;

  /** Branch/agent where cash was received */
  branchCode: string;
  branchName: string;

  /** Purpose of the transaction as stated by customer */
  statedPurpose: string;

  /** Whether ID was verified at counter */
  idVerified: boolean;

  /** FIC acknowledgement reference */
  ficAcknowledgementRef: string | null;
}

// ============================================================================
// Data Protection Commission (DPC) Reports
// ============================================================================

/**
 * DPC Personal Data Breach Notification
 * @see Data Protection Act 2012 §37: Report to DPC within 72 hours
 *
 * CRITICAL: 72-hour deadline from discovery. Missing this deadline
 * constitutes a separate breach of the DPA.
 */
export interface DpcBreachNotification {
  metadata: ReportMetadata;

  /** ISO 8601 timestamp breach was DISCOVERED */
  discoveredAt: string;

  /**
   * ISO 8601 DEADLINE for DPC notification (72 hours from discoveredAt)
   */
  dpcNotificationDeadline: string;

  /**
   * Nature of the breach
   */
  breachType:
    | 'UNAUTHORISED_ACCESS'
    | 'DATA_EXFILTRATION'
    | 'ACCIDENTAL_DISCLOSURE'
    | 'SYSTEM_COMPROMISE'
    | 'PHYSICAL_BREACH'
    | 'RANSOMWARE'
    | 'INSIDER_THREAT'
    | 'THIRD_PARTY_BREACH'
    | 'OTHER';

  /** Description of what happened */
  breachDescription: string;

  /** Number of data subjects potentially affected */
  affectedDataSubjectsCount: number;

  /** Categories of personal data involved */
  dataCategories: Array<
    | 'GHANA_CARD_NUMBERS'
    | 'BIOMETRIC_DATA'
    | 'FINANCIAL_DATA'
    | 'TRANSACTION_HISTORY'
    | 'CONTACT_INFORMATION'
    | 'HEALTH_DATA'
    | 'OTHER'
  >;

  /** Likely consequences of the breach */
  likelyConsequences: string;

  /** Measures taken to address the breach */
  remediationMeasures: string;

  /** Whether affected data subjects have been notified */
  dataSubjectsNotified: boolean;
  dataSubjectsNotifiedAt: string | null;

  /** Whether the breach has been contained */
  breachContained: boolean;
  breachContainedAt: string | null;

  /** DPC case reference number */
  dpcCaseRef: string | null;
  dpcAcknowledgedAt: string | null;
}

// ============================================================================
// Credit Bureau Report
// ============================================================================

/**
 * Monthly credit bureau reporting — CRB Africa
 * @see Credit Reporting Act 2007 (Act 726) §9
 * Due: Within 7 days of month-end
 */
export interface CreditBureauMonthlyReport {
  metadata: ReportMetadata;

  /** Reporting period */
  reportingMonth: string;

  /** Total loan accounts reported */
  totalAccountsReported: number;

  /** New accounts opened this period */
  newAccountsCount: number;

  /** Accounts with status changes (closed, written-off, restructured) */
  statusChangedAccountsCount: number;

  /** Accounts with payment updates */
  paymentUpdatesCount: number;

  /**
   * Individual account records submitted.
   * Each record follows CRB Africa's reporting format.
   * Trimmed to key fields here (full format in bureau integration).
   */
  accountRecords: Array<{
    customerId: string;
    ghanaCardNumber: string;
    loanAccountNumber: string;
    creditLimit: number;
    outstandingBalance: number;
    amountPastDue: number;
    daysPastDue: number;
    paymentStatus: 'CURRENT' | 'PAST_DUE_30' | 'PAST_DUE_60' | 'PAST_DUE_90' | 'DEFAULT' | 'WRITTEN_OFF' | 'CLOSED';
    reportingDate: string;
  }>;

  /** CRB Africa acknowledgement reference */
  bureauAcknowledgementRef: string | null;
}
