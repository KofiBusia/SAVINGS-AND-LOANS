// In production, set EXPO_PUBLIC_API_URL in your .env or app.json extra
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://api.savingsloans.com.gh';

export const API_V1 = `${API_BASE_URL}/api/v1`;
