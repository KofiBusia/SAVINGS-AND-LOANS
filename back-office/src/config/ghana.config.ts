import { registerAs } from '@nestjs/config';

export default registerAs('ghana', () => ({
  // NIA Ghana Card verification
  nia: {
    baseUrl: process.env.NIA_API_BASE_URL ?? 'https://verify.nia.gov.gh/api/v1',
    apiKey: process.env.NIA_API_KEY ?? '',
    timeoutMs: parseInt(process.env.NIA_API_TIMEOUT_MS ?? '30000'),
    offlineCacheTtlHours: parseInt(process.env.NIA_OFFLINE_CACHE_TTL_HOURS ?? '48'),
    useMock: process.env.NIA_USE_MOCK === 'true',
  },

  // GhIPSS Mobile Money Interface
  ghipss: {
    baseUrl: process.env.GHIPSS_BASE_URL ?? 'https://api.ghipss.net/mmi/v2',
    institutionCode: process.env.GHIPSS_INSTITUTION_CODE ?? '',
    apiKey: process.env.GHIPSS_API_KEY ?? '',
    webhookSecret: process.env.GHIPSS_WEBHOOK_SECRET ?? '',
    timeoutMs: parseInt(process.env.GHIPSS_TIMEOUT_MS ?? '45000'),
    maxRetries: parseInt(process.env.GHIPSS_MAX_RETRIES ?? '3'),
    useMock: process.env.GHIPSS_USE_MOCK === 'true',
  },

  // Credit Bureaus
  creditBureaus: {
    xds: {
      baseUrl: process.env.XDS_BASE_URL ?? 'https://api.xdsghana.com/v2',
      apiKey: process.env.XDS_API_KEY ?? '',
      institutionCode: process.env.XDS_INSTITUTION_CODE ?? '',
      useMock: process.env.XDS_USE_MOCK === 'true',
    },
    dnb: {
      baseUrl: process.env.DNB_BASE_URL ?? 'https://api.dnb.com/v1',
      apiKey: process.env.DNB_API_KEY ?? '',
      useMock: process.env.DNB_USE_MOCK === 'true',
    },
    myCredit: {
      baseUrl: process.env.MYCREDIT_BASE_URL ?? 'https://api.mycreditscore.com.gh/v1',
      apiKey: process.env.MYCREDIT_API_KEY ?? '',
      useMock: process.env.MYCREDIT_USE_MOCK === 'true',
    },
  },

  // FIC Reporting (AML Act 1044)
  fic: {
    strSubmissionUrl: process.env.FIC_STR_SUBMISSION_URL ?? 'https://goaml.fic.gov.gh/api/v2/str',
    ctrSubmissionUrl: process.env.FIC_CTR_SUBMISSION_URL ?? 'https://goaml.fic.gov.gh/api/v2/ctr',
    apiKey: process.env.FIC_API_KEY ?? '',
    institutionCode: process.env.FIC_INSTITUTION_CODE ?? '',
    reportingName: process.env.FIC_REPORTING_NAME ?? 'Ghana Savings & Loans Ltd',
  },

  // Bank of Ghana
  bog: {
    reportingEmail: process.env.BOG_REPORTING_EMAIL ?? 'prudential@bog.gov.gh',
    institutionCode: process.env.BOG_INSTITUTION_CODE ?? '',
    prudentialReturnDueDay: parseInt(process.env.BOG_PRUDENTIAL_RETURN_DUE_DAY ?? '15'),
  },

  // Payment Gateways
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? '',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET ?? '',
  },

  // SMS
  mnotify: {
    apiKey: process.env.MNOTIFY_API_KEY ?? '',
    senderId: process.env.MNOTIFY_SENDER_ID ?? 'SavingsLoans',
  },

  // Data residency (Data Protection Act 843)
  dataResidency: {
    permittedRegions: (process.env.ALLOWED_DATA_REGIONS ?? 'gh-accra-1').split(','),
    currentRegion: process.env.GHANA_DATA_REGION ?? 'gh-accra-1',
    piiExportBlock: process.env.PII_EXPORT_BLOCK !== 'false',
  },
}));
