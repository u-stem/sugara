import { CENTER, OFFICE_CENTER, OFFICE_NAME } from "./weather-area-i18n";

type Lang = "ja" | "en";

function lang(locale: string): Lang {
  return locale === "en" ? "en" : "ja";
}

// All names resolve synchronously from the static maps by code, so the UI can
// render before (or without) the API response. Fall back to the code if unmapped.
export function officeName(officeCode: string, locale: string): string {
  return OFFICE_NAME[officeCode]?.[lang(locale)] ?? officeCode;
}

export function centerName(centerCode: string, locale: string): string {
  return CENTER[centerCode]?.[lang(locale)].full ?? centerCode;
}

export function centerShort(centerCode: string, locale: string): string {
  return CENTER[centerCode]?.[lang(locale)].short ?? centerCode;
}

// The detail screen knows only the officeCode; resolve its center name.
export function centerNameForOffice(officeCode: string, locale: string): string {
  const centerCode = OFFICE_CENTER[officeCode];
  return centerCode ? centerName(centerCode, locale) : "";
}
