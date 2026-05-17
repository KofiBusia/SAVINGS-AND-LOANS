/**
 * Local language translations for Ghana Savings & Loans mobile app.
 * Supported: English (en), Twi/Akan (tw), Ga (ga), Ewe (ee), Hausa (ha)
 *
 * Banking terms sourced from community validation with native speakers.
 */

export type GhanaLanguage = "en" | "tw" | "ga" | "ee" | "ha";

export const translations: Record<GhanaLanguage, Record<string, string>> = {
  en: {
    // General
    "app.name": "Ghana Savings & Loans",
    "app.tagline": "Your trusted financial partner",
    "common.continue": "Continue",
    "common.cancel": "Cancel",
    "common.submit": "Submit",
    "common.loading": "Loading...",
    "common.error": "An error occurred",
    "common.retry": "Retry",
    "common.offline": "You are offline",
    "common.sync": "Syncing...",

    // Authentication
    "auth.login": "Sign In",
    "auth.logout": "Sign Out",
    "auth.mfa.title": "Two-Factor Authentication",
    "auth.mfa.prompt": "Enter the 6-digit code from your authenticator app",
    "auth.mfa.setup": "Set up 2FA",
    "auth.biometric": "Use Biometric Login",

    // KYC
    "kyc.scan_ghana_card": "Scan Ghana Card",
    "kyc.position_card": "Position your Ghana Card within the frame",
    "kyc.liveness_check": "Liveness Check",
    "kyc.look_at_camera": "Please look directly at the camera",
    "kyc.address_verification": "Address Verification",
    "kyc.income_declaration": "Income Declaration",
    "kyc.consent_title": "Data Processing Consent",
    "kyc.pre_agreement": "Loan Pre-Agreement",
    "kyc.sign_agreement": "Sign Agreement",
    "kyc.account_activated": "Account Activated",

    // Loans
    "loan.apply": "Apply for Loan",
    "loan.amount": "Loan Amount",
    "loan.term": "Loan Term",
    "loan.interest_rate": "Interest Rate",
    "loan.monthly_payment": "Monthly Payment",
    "loan.total_repayment": "Total Repayment",
    "loan.purpose": "Loan Purpose",
    "loan.disbursed": "Loan Disbursed",
    "loan.repay": "Make Repayment",
    "loan.outstanding": "Outstanding Balance",
    "loan.next_payment": "Next Payment Due",
    "loan.interest_type": "Simple Interest (BoG Compliant)",
    "loan.no_compounding": "This loan uses simple interest only",
    "loan.overdue": "Overdue",

    // Savings
    "savings.balance": "Balance",
    "savings.deposit": "Deposit",
    "savings.withdraw": "Withdraw",
    "savings.interest_earned": "Interest Earned",
    "savings.account_number": "Account Number",
    "savings.locked_until": "Locked Until",

    // Compliance
    "compliance.dcd_footer": "Licensed by Bank of Ghana | Digital Credit Directive 2025",
    "compliance.complaint_days": "Complaints resolved within 20 days",
    "compliance.ussd_code": "USSD: *713*01#",
    "compliance.data_rights": "Your data rights under Data Protection Act 843",
    "complaint.submit": "Submit Complaint",
    "complaint.sla": "We will respond within 20 working days",

    // Mobile Money
    "momo.pay_with": "Pay with",
    "momo.mtn": "MTN MoMo",
    "momo.telecel": "Telecel Cash",
    "momo.airteltigo": "AirtelTigo Money",
    "momo.confirm": "Confirm Payment",
    "momo.success": "Payment Successful",
    "momo.failed": "Payment Failed",
    "momo.pending": "Payment Pending",

    // Privacy
    "privacy.title": "Privacy Controls",
    "privacy.dsar": "Request My Data",
    "privacy.delete": "Delete My Data",
    "privacy.withdraw_consent": "Withdraw Consent",
    "privacy.dpa_rights": "Data Protection Act 843 Rights",
  },

  tw: {
    // Twi (Akan) - Banking terms
    "app.name": "Ghana Sika Ne Akyede",
    "app.tagline": "W'adepam sika baako pa",
    "common.continue": "Kɔ so",
    "common.cancel": "Gyae",
    "common.submit": "Fa kɔ",
    "common.loading": "Twen...",
    "common.error": "Nsem bi ba",
    "common.retry": "San hwɛ bio",
    "common.offline": "Wo nni net mu",
    "common.sync": "Bɔ mu...",
    "auth.login": "Wo hyɛ mu",
    "auth.logout": "Pue",
    "kyc.scan_ghana_card": "Scan w'Ghana Card",
    "kyc.account_activated": "Wo akaunti da ho adepa",
    "loan.apply": "Bisa kaman",
    "loan.amount": "Kaman dodow",
    "loan.monthly_payment": "Bosome biara na wubetua",
    "loan.interest_rate": "Dwan sika ɛkwan",
    "loan.outstanding": "Sika a wɔda wo ho",
    "loan.next_payment": "Tua da a edi hɔ",
    "loan.repay": "Tua kaman no",
    "loan.no_compounding": "Kaman yi fa simple interest nkoaa",
    "savings.balance": "Sumdina",
    "savings.deposit": "De sika kɔ",
    "savings.withdraw": "Gye sika",
    "savings.interest_earned": "Dwan sika a wonya",
    "momo.pay_with": "Tua ne",
    "momo.success": "Wutua adepa",
    "momo.failed": "Ɛntua",
    "compliance.complaint_days": "Yɛde nsem kuntanikyi da 20 mu",
    "privacy.dsar": "Bisa w'ho nsem",
  },

  ga: {
    // Ga language - Banking terms
    "app.name": "Ghana Sika Shi Adahan",
    "app.tagline": "Mii sika kɛ atsε he",
    "common.continue": "Bε kε",
    "common.cancel": "Bue",
    "common.submit": "Tɔɔ",
    "common.loading": "Gbεi...",
    "common.error": "Kεε bi yεε",
    "common.offline": "Wᴐ fε internet lɛ",
    "common.sync": "Bɔ mu...",
    "auth.login": "Bε ji",
    "loan.apply": "Bisa loan",
    "loan.amount": "Sika baa",
    "loan.monthly_payment": "Ngmɛi biaa yɛ tua",
    "loan.outstanding": "Sika akε wᴐ ho",
    "savings.balance": "Sika nyɛmɔ",
    "savings.deposit": "Ji sika",
    "savings.withdraw": "Bii sika",
    "momo.success": "Wᴐ tua adepa",
    "compliance.complaint_days": "Mii nyεmᴐ yεε ngmɛi 20",
    "privacy.dsar": "Bisa wᴐ ho nsem",
  },

  ee: {
    // Ewe language - Banking terms
    "app.name": "Ghana Gadzraƒe kple Adingɔ",
    "app.tagline": "Ame siwo dze wò ƒe gadzraƒe ŋu",
    "common.continue": "Yi gbɔ",
    "common.cancel": "Ɖe",
    "common.submit": "Ɖo",
    "common.loading": "Ɖo aʋame...",
    "common.error": "Nuti kple do",
    "common.offline": "Èle internet ŋu o",
    "common.sync": "Ŋlɔ...",
    "auth.login": "Ŋlɔ",
    "loan.apply": "Kpe adingɔ",
    "loan.amount": "Gadzraƒe",
    "loan.monthly_payment": "Ɣleti sia ɣleti biana",
    "loan.outstanding": "Gadzraƒe siwo le ŋdi",
    "loan.no_compounding": "Adingɔ si nana atsina faɖoɖo nkoaa",
    "savings.balance": "Ƒoƒo",
    "savings.deposit": "Tso ga dzi",
    "savings.withdraw": "Tso ga",
    "savings.interest_earned": "Atsina siwo wò xɔ",
    "momo.success": "Biana ɖo nyuie",
    "compliance.complaint_days": "Miaɖo dzinye le ŋkeke 20 me",
    "privacy.dsar": "Kpe wò ŋkɔ kple wò hã",
  },

  ha: {
    // Hausa language - Banking terms
    "app.name": "Ajiyar Ghana da Lamuni",
    "app.tagline": "Abokin ku na kudi",
    "common.continue": "Ci gaba",
    "common.cancel": "Soke",
    "common.submit": "Aika",
    "common.loading": "Ana jira...",
    "common.error": "Kuskure ya faru",
    "common.offline": "Ba ka da intanet",
    "common.sync": "Ana syncing...",
    "auth.login": "Shiga",
    "auth.logout": "Fita",
    "loan.apply": "Nemi lamuni",
    "loan.amount": "Adadin lamuni",
    "loan.monthly_payment": "Biyan kowane wata",
    "loan.interest_rate": "Riba",
    "loan.outstanding": "Kudi da ya rage",
    "loan.next_payment": "Lokacin biya mai zuwa",
    "loan.no_compounding": "Wannan lamuni yana amfani da riba mai sauƙi",
    "savings.balance": "Ma'auni",
    "savings.deposit": "Saka kudi",
    "savings.withdraw": "Cire kudi",
    "savings.interest_earned": "Riba da ka samu",
    "momo.pay_with": "Biya da",
    "momo.success": "Biyan ya yi nasara",
    "momo.failed": "Biyan bai yi nasara ba",
    "compliance.complaint_days": "Muna warware korafi a cikin kwanaki 20",
    "privacy.dsar": "Nemi bayananku",
  },
};

export function t(key: string, language: GhanaLanguage = "en"): string {
  return translations[language]?.[key] ?? translations.en[key] ?? key;
}
