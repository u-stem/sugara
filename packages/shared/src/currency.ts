import { z } from "zod";

const CURRENCY_CODES = [
  "JPY",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "KRW",
  "THB",
  "SGD",
  "HKD",
] as const;

export const currencyCodeSchema = z.enum(CURRENCY_CODES);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

// Parse an arbitrary string (e.g. a trip's stored currency) into a CurrencyCode,
// falling back to JPY for unknown values. Avoids `as` casts at call sites.
export function toCurrencyCode(value: string | null | undefined): CurrencyCode {
  const parsed = currencyCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : "JPY";
}

type CurrencyDef = {
  code: CurrencyCode;
  name: string;
  nameJa: string;
  symbol: string;
  decimals: number;
};

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  JPY: { code: "JPY", name: "Japanese Yen", nameJa: "日本円", symbol: "¥", decimals: 0 },
  USD: { code: "USD", name: "US Dollar", nameJa: "米ドル", symbol: "$", decimals: 2 },
  EUR: { code: "EUR", name: "Euro", nameJa: "ユーロ", symbol: "€", decimals: 2 },
  GBP: { code: "GBP", name: "Pound Sterling", nameJa: "英ポンド", symbol: "£", decimals: 2 },
  AUD: { code: "AUD", name: "Australian Dollar", nameJa: "豪ドル", symbol: "A$", decimals: 2 },
  CAD: { code: "CAD", name: "Canadian Dollar", nameJa: "カナダドル", symbol: "C$", decimals: 2 },
  CHF: { code: "CHF", name: "Swiss Franc", nameJa: "スイスフラン", symbol: "CHF", decimals: 2 },
  CNY: { code: "CNY", name: "Chinese Yuan", nameJa: "人民元", symbol: "¥", decimals: 2 },
  KRW: { code: "KRW", name: "South Korean Won", nameJa: "韓国ウォン", symbol: "₩", decimals: 0 },
  THB: { code: "THB", name: "Thai Baht", nameJa: "タイバーツ", symbol: "฿", decimals: 2 },
  SGD: {
    code: "SGD",
    name: "Singapore Dollar",
    nameJa: "シンガポールドル",
    symbol: "S$",
    decimals: 2,
  },
  HKD: { code: "HKD", name: "Hong Kong Dollar", nameJa: "香港ドル", symbol: "HK$", decimals: 2 },
};

export function toMinorUnits(amount: number, currency: CurrencyCode): number {
  const { decimals } = CURRENCIES[currency];
  return Math.round(amount * 10 ** decimals);
}

export function fromMinorUnits(minorAmount: number, currency: CurrencyCode): number {
  const { decimals } = CURRENCIES[currency];
  return minorAmount / 10 ** decimals;
}

// Input step for an amount field: one minor unit expressed in major units (e.g. "0.01" for USD, "1" for JPY).
export function getAmountInputStep(currency: CurrencyCode): string {
  const { decimals } = CURRENCIES[currency];
  return decimals > 0 ? (1 / 10 ** decimals).toString() : "1";
}

// Converts fromMinor units of fromCurrency to minor units of baseCurrency.
// Formula: round(fromMinor * rate * 10^baseDecimals / 10^fromDecimals)
// Rate is the number of baseCurrency major units per 1 fromCurrency major unit.
export function convertToBase(
  fromMinor: number,
  fromCurrency: CurrencyCode,
  baseCurrency: CurrencyCode,
  rate: number,
): number {
  if (fromCurrency === baseCurrency) return fromMinor;
  const fromDecimals = CURRENCIES[fromCurrency].decimals;
  const baseDecimals = CURRENCIES[baseCurrency].decimals;
  return Math.round((fromMinor * rate * 10 ** baseDecimals) / 10 ** fromDecimals);
}

export function formatCurrency(
  minorAmount: number,
  currency: CurrencyCode,
  locale: string,
): string {
  const displayAmount = fromMinorUnits(minorAmount, currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: CURRENCIES[currency].decimals,
    maximumFractionDigits: CURRENCIES[currency].decimals,
  }).format(displayAmount);
}

// Format a whole-unit amount (e.g. schedules.cost, a planning-only fare estimate
// expressed directly in the trip currency's major units) without minor-unit
// scaling. Unlike formatCurrency, the input is NOT divided by 10^decimals, and
// fractional digits are dropped so 580 renders as "¥580" / "$580" rather than
// "$5.80". This unit system is distinct from expenses.amount (minor units).
export function formatWholeUnits(amount: number, currency: CurrencyCode, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
