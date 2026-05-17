/** Ghana-specific constants: MNOs, banks, regions, GhIPSS codes */

export const GHANA_MNO = {
  MTN: {
    name: 'MTN Ghana',
    prefix: ['024', '054', '055', '059'],
    mobileMoney: 'MTN MoMo',
    ghipssCode: 'MTN_GH',
    ussdCode: '*170#',
  },
  TELECEL: {
    name: 'Telecel Ghana',
    prefix: ['020', '050'],
    mobileMoney: 'Telecel Cash',
    ghipssCode: 'TCL_GH',
    ussdCode: '*110#',
  },
  AIRTELTIGO: {
    name: 'AirtelTigo Ghana',
    prefix: ['026', '056', '027', '057'],
    mobileMoney: 'AirtelTigo Money',
    ghipssCode: 'ATG_GH',
    ussdCode: '*500#',
  },
} as const;

export const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Western', 'Eastern', 'Central',
  'Volta', 'Northern', 'Upper East', 'Upper West', 'Brong-Ahafo',
  'Oti', 'Bono East', 'Ahafo', 'Western North', 'Savannah',
  'North East',
] as const;

export const GHANA_LANGUAGES = {
  en: 'English',
  tw: 'Twi (Akan)',
  ga: 'Ga',
  ee: 'Ewe',
  ha: 'Hausa',
} as const;

export type GhanaLanguage = keyof typeof GHANA_LANGUAGES;

export const GHANA_CURRENCY = {
  code: 'GHS',
  symbol: 'GH₵',
  name: 'Ghana Cedi',
  subunit: 'pesewa',
  subunitRatio: 100,
} as const;

// Bank of Ghana sort codes for major banks
export const GHANA_BANK_CODES: Record<string, string> = {
  'GCB': '040100',
  'ABSA': '030100',
  'ECOBANK': '130100',
  'FIDELITY': '240100',
  'STANDARD_CHARTERED': '020100',
  'CAL_BANK': '140100',
  'ACCESS_BANK': '280100',
  'ZENITH_BANK': '120100',
  'SOCIETE_GENERALE': '170100',
  'UBA': '060100',
};

// GhanaPost GPS format validation
export const GHANA_POST_GPS_REGEX = /^[A-Z]{2}-\d{3,4}-\d{4,5}$/;

// Ghana phone number format
export const GHANA_PHONE_REGEX = /^(\+233|0)[2345]\d{8}$/;

// Normalize phone to international format
export function normalizeGhanaPhone(phone: string): string {
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+233')) return cleaned;
  if (cleaned.startsWith('0')) return '+233' + cleaned.slice(1);
  if (cleaned.startsWith('233')) return '+' + cleaned;
  throw new Error(`Invalid Ghana phone number: ${phone}`);
}

export function detectMNO(phone: string): keyof typeof GHANA_MNO | null {
  const normalized = normalizeGhanaPhone(phone);
  const localPrefix = '0' + normalized.slice(4, 7);
  for (const [mno, config] of Object.entries(GHANA_MNO)) {
    if ((config.prefix as readonly string[]).some(p => localPrefix.startsWith(p))) {
      return mno as keyof typeof GHANA_MNO;
    }
  }
  return null;
}
