import type {
  CandidateResponse,
  CurrencyCode,
  DayPatternResponse,
  DayResponse,
  ExpensesResponse,
  ScheduleResponse,
  TripResponse,
} from "@sugara/shared";
import {
  formatWholeUnits,
  fromMinorUnits,
  getSplitDisplayCurrency,
  toCurrencyCode,
} from "@sugara/shared";
import { formatDate, formatTime, toDateString } from "@/lib/format";

// Ordered by: When → What → Where → How → Extra → Meta
export const EXPORT_FIELDS = [
  "date",
  "dayNumber",
  "startTime",
  "endTime",
  "name",
  "category",
  "address",
  "departurePlace",
  "arrivalPlace",
  "transportMethod",
  "cost",
  "urls",
  "memo",
  "pattern",
] as const;

export type ExportField = (typeof EXPORT_FIELDS)[number];

export type ExportFieldLabels = Record<ExportField, string>;

/** Labels for translating enum values in export data cells */
export type ValueLabels = {
  category: (key: string) => string;
  transportMethod: (key: string) => string;
  splitType: (key: string) => string;
  expenseCategory: (key: string) => string;
};

// Default labels (English fallback) used when no translation is provided
const DEFAULT_EXPORT_FIELD_LABELS: ExportFieldLabels = {
  date: "Date",
  dayNumber: "Day",
  startTime: "Start Time",
  endTime: "End Time",
  name: "Name",
  category: "Category",
  address: "Address",
  departurePlace: "Departure",
  arrivalPlace: "Arrival",
  transportMethod: "Transport",
  cost: "Fare",
  urls: "URL",
  memo: "Memo",
  pattern: "Pattern",
};

/** @deprecated Use translated labels from exportLabels namespace instead */
export const EXPORT_FIELD_LABELS = DEFAULT_EXPORT_FIELD_LABELS;

export const DEFAULT_SELECTED_FIELDS: ExportField[] = [
  "date",
  "name",
  "startTime",
  "endTime",
  "address",
  "urls",
];

export type ExportFormat = "xlsx" | "csv" | "ics";

export type PatternMode = "separateSheets" | "patternColumn";

export type CSVDelimiter = "comma" | "tab";
export type CSVLineEnding = "crlf" | "lf";

export type CSVOptions = {
  delimiter: CSVDelimiter;
  bom: boolean;
  lineEnding: CSVLineEnding;
};

export const DEFAULT_CSV_OPTIONS: CSVOptions = {
  delimiter: "comma",
  bom: true,
  lineEnding: "crlf",
};

export type ExpenseExportItem = {
  title: string;
  amount: number;
  paidByName: string;
  splitType: string;
  category: string | null;
  splits: { name: string; amount: number }[];
};

export type ExpenseSettlement = {
  totalAmount: number;
  balances: { name: string; net: number }[];
  transfers: { fromName: string; toName: string; amount: number }[];
};

export type ExpenseExportData = {
  expenses: ExpenseExportItem[];
  settlement: ExpenseSettlement;
};

export type ExpenseExportHeaders = {
  title: string;
  category: string;
  amount: string;
  paidBy: string;
  splitType: string;
};

const DEFAULT_EXPENSE_EXPORT_HEADERS: ExpenseExportHeaders = {
  title: "Title",
  category: "Category",
  amount: "Amount",
  paidBy: "Paid By",
  splitType: "Split Type",
};

/** @deprecated Use translated labels from exportLabels namespace instead */
export const EXPENSE_EXPORT_HEADERS = DEFAULT_EXPENSE_EXPORT_HEADERS;

export type ExportSheetNames = {
  itinerary: string;
  candidates: string;
  expenses: string;
  csvCandidatesSeparator: string;
  csvExpensesSeparator: string;
};

export type ExportOptions = {
  format?: ExportFormat;
  fields: ExportField[];
  patternMode: PatternMode;
  includeCandidates: boolean;
  includeExpenses: boolean;
  expenseData?: ExpenseExportData;
  fileName?: string;
  csvOptions?: CSVOptions;
  fieldLabels?: ExportFieldLabels;
  expenseLabels?: ExpenseExportLabels;
  sheetNames?: ExportSheetNames;
  locale?: string;
  valueLabels?: ValueLabels;
};

export function buildDefaultFileName(tripTitle: string): string {
  return `${tripTitle}_${toDateString(new Date())}`;
}

// Fields not applicable to candidates (no day/pattern context)
const CANDIDATE_EXCLUDED_FIELDS: Set<ExportField> = new Set(["date", "dayNumber", "pattern"]);

export function filterCandidateFields(fields: ExportField[]): ExportField[] {
  return fields.filter((f) => !CANDIDATE_EXCLUDED_FIELDS.has(f));
}

export function scheduleToRow(
  schedule: ScheduleResponse,
  day: DayResponse,
  patternLabel: string | null,
  fields: ExportField[],
  fieldLabels?: ExportFieldLabels,
  locale?: string,
  valueLabels?: ValueLabels,
  currency?: CurrencyCode,
): Record<string, string | number> {
  const labels = fieldLabels ?? DEFAULT_EXPORT_FIELD_LABELS;
  const row: Record<string, string | number> = {};
  for (const field of fields) {
    const label = labels[field];
    switch (field) {
      case "date":
        row[label] = formatDate(day.date, { locale });
        break;
      case "dayNumber":
        row[label] = day.dayNumber;
        break;
      case "pattern":
        row[label] = patternLabel ?? "";
        break;
      case "category":
        row[label] = valueLabels ? valueLabels.category(schedule.category) : schedule.category;
        break;
      case "startTime":
        row[label] = schedule.startTime ? formatTime(schedule.startTime) : "";
        break;
      case "endTime":
        row[label] = schedule.endTime ? formatTime(schedule.endTime) : "";
        break;
      case "transportMethod":
        row[label] = schedule.transportMethod
          ? valueLabels
            ? valueLabels.transportMethod(schedule.transportMethod)
            : schedule.transportMethod
          : "";
        break;
      case "cost":
        // cost is a whole-unit fare estimate meaningful only for transport rows
        // (matches candidate-item's guard). Other categories leave it blank.
        // formatWholeUnits skips minor-unit scaling so non-JPY trip currencies
        // render correctly (e.g. 580 -> $580, not $5.80).
        row[label] =
          schedule.category === "transport" && schedule.cost != null
            ? formatWholeUnits(schedule.cost, currency ?? "JPY", locale ?? "en")
            : "";
        break;
      case "urls":
        row[label] = schedule.urls.join("\n");
        break;
      default:
        row[label] = (schedule[field as keyof ScheduleResponse] as string) ?? "";
        break;
    }
  }
  return row;
}

export function buildScheduleRows(
  day: DayResponse,
  patterns: DayPatternResponse[],
  fields: ExportField[],
  fieldLabels?: ExportFieldLabels,
  locale?: string,
  valueLabels?: ValueLabels,
  currency?: CurrencyCode,
): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = [];
  for (const pattern of patterns) {
    const sorted = [...pattern.schedules].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const schedule of sorted) {
      rows.push(
        scheduleToRow(
          schedule,
          day,
          pattern.label,
          fields,
          fieldLabels,
          locale,
          valueLabels,
          currency,
        ),
      );
    }
  }
  return rows;
}

export function buildCandidateRows(
  candidates: CandidateResponse[],
  fields: ExportField[],
  fieldLabels?: ExportFieldLabels,
  locale?: string,
  valueLabels?: ValueLabels,
  currency?: CurrencyCode,
): Record<string, string | number>[] {
  const candidateFields = filterCandidateFields(fields);
  const stubDay: DayResponse = {
    id: "",
    dayNumber: 0,
    date: "",
    memo: null,
    patterns: [],
  };

  return candidates.map((candidate) =>
    scheduleToRow(
      candidate,
      stubDay,
      null,
      candidateFields,
      fieldLabels,
      locale,
      valueLabels,
      currency,
    ),
  );
}

const DEFAULT_MAX_PREVIEW_ROWS = 3;

/** Build sample rows for the preview table. */
export function buildPreviewRows(
  trip: TripResponse,
  fields: ExportField[],
  maxRows: number = DEFAULT_MAX_PREVIEW_ROWS,
  locale?: string,
  valueLabels?: ValueLabels,
): Record<string, string | number>[] {
  const currency = toCurrencyCode(trip.currency);
  const rows: Record<string, string | number>[] = [];
  for (const day of trip.days) {
    if (rows.length >= maxRows) break;
    for (const pattern of day.patterns) {
      if (rows.length >= maxRows) break;
      const sorted = [...pattern.schedules].sort((a, b) => a.sortOrder - b.sortOrder);
      for (const schedule of sorted) {
        if (rows.length >= maxRows) break;
        rows.push(
          scheduleToRow(
            schedule,
            day,
            pattern.label,
            fields,
            undefined,
            locale,
            valueLabels,
            currency,
          ),
        );
      }
    }
  }
  return rows;
}

// Convert API response amounts (minor units) to major units for spreadsheet cells.
// Equal splits are stored in trip currency; custom/itemized use the expense currency.
export function toExpenseExportData(
  data: ExpensesResponse,
  translateCategory?: (key: string) => string,
): ExpenseExportData {
  const tripCurrency = data.tripCurrency;
  return {
    expenses: data.expenses.map((e) => ({
      title: e.title,
      amount: fromMinorUnits(e.amount, e.currency),
      paidByName: e.paidByUser.name,
      splitType: e.splitType,
      category: e.category
        ? translateCategory
          ? translateCategory(e.category)
          : e.category
        : null,
      splits: e.splits.map((s) => ({
        name: s.user.name,
        amount: fromMinorUnits(
          s.amount,
          getSplitDisplayCurrency(e.splitType, tripCurrency, e.currency),
        ),
      })),
    })),
    settlement: {
      totalAmount: fromMinorUnits(data.settlement.totalAmount, tripCurrency),
      balances: data.settlement.balances.map((b) => ({
        name: b.name,
        net: fromMinorUnits(b.net, tripCurrency),
      })),
      transfers: data.settlement.transfers.map((t) => ({
        fromName: t.from.name,
        toName: t.to.name,
        amount: fromMinorUnits(t.amount, tripCurrency),
      })),
    },
  };
}

export type ExpenseExportResult = {
  headers: string[];
  rows: Record<string, string | number>[];
};

export type ExpenseExportLabels = ExpenseExportHeaders & {
  total: string;
  balanceSection: string;
  settlementSection: string;
  transferArrow: (from: string, to: string) => string;
};

export function buildExpenseExport(
  data: ExpenseExportData,
  labels?: ExpenseExportLabels,
  valueLabels?: ValueLabels,
): ExpenseExportResult {
  const defaultLabels: ExpenseExportLabels = {
    ...DEFAULT_EXPENSE_EXPORT_HEADERS,
    total: "Total",
    balanceSection: "[Balance]",
    settlementSection: "[Settlement]",
    transferArrow: (from, to) => `${from} → ${to}`,
  };
  const L = labels ?? defaultLabels;
  const H = {
    title: L.title,
    category: L.category,
    amount: L.amount,
    paidBy: L.paidBy,
    splitType: L.splitType,
  };

  // Collect unique member names in sorted order for stable output
  const memberNameSet = new Set<string>();
  for (const e of data.expenses) {
    for (const s of e.splits) {
      memberNameSet.add(s.name);
    }
  }
  const memberNames = [...memberNameSet].sort((a, b) => a.localeCompare(b));

  const staticHeaders = Object.values(H);
  const headers = [...staticHeaders, ...memberNames];

  const blank = (): Record<string, string | number> => {
    const row: Record<string, string | number> = {};
    for (const h of headers) row[h] = "";
    return row;
  };

  const rows: Record<string, string | number>[] = [];

  // Expense list
  for (const e of data.expenses) {
    const row: Record<string, string | number> = {
      [H.category]: e.category ?? "",
      [H.title]: e.title,
      [H.amount]: e.amount,
      [H.paidBy]: e.paidByName,
      [H.splitType]: valueLabels ? valueLabels.splitType(e.splitType) : e.splitType,
    };
    // Per-member split amounts
    const splitMap = new Map(e.splits.map((s) => [s.name, s.amount]));
    for (const name of memberNames) {
      row[name] = splitMap.get(name) ?? "";
    }
    rows.push(row);
  }

  // Total
  rows.push(blank());
  rows.push({
    ...blank(),
    [H.title]: L.total,
    [H.amount]: data.settlement.totalAmount,
  });

  // Balances (skip if all zero)
  const nonZeroBalances = data.settlement.balances
    .filter((b) => b.net !== 0)
    .sort((a, b) => b.net - a.net);

  if (nonZeroBalances.length > 0) {
    rows.push(blank());
    rows.push({ ...blank(), [H.title]: L.balanceSection });
    for (const b of nonZeroBalances) {
      rows.push({ ...blank(), [H.title]: b.name, [H.amount]: b.net });
    }
  }

  // Transfers
  if (data.settlement.transfers.length > 0) {
    const sorted = [...data.settlement.transfers].sort((a, b) => b.amount - a.amount);
    rows.push(blank());
    rows.push({ ...blank(), [H.title]: L.settlementSection });
    for (const t of sorted) {
      rows.push({
        ...blank(),
        [H.title]: L.transferArrow(t.fromName, t.toName),
        [H.amount]: t.amount,
      });
    }
  }

  return { headers, rows };
}

function addRowsToWorksheet(
  wb: import("exceljs").Workbook,
  sheetName: string,
  rows: Record<string, string | number>[],
  headers?: string[],
): void {
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  if (rows.length === 0) return;
  const cols = headers ?? Object.keys(rows[0]);
  ws.columns = cols.map((key) => ({ header: key, key }));
  for (const row of rows) {
    ws.addRow(row);
  }
}

export async function exportTripToExcel(trip: TripResponse, options: ExportOptions): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.Workbook();

  // Exclude pattern field unless patternColumn mode
  const fields =
    options.patternMode === "patternColumn"
      ? options.fields
      : options.fields.filter((f) => f !== "pattern");

  const sn = options.sheetNames ?? {
    itinerary: "Itinerary",
    candidates: "Candidates",
    expenses: "Expenses",
    csvCandidatesSeparator: "--- Candidates ---",
    csvExpensesSeparator: "--- Expenses ---",
  };
  const fl = options.fieldLabels;
  const loc = options.locale;
  const vl = options.valueLabels;
  const cur = toCurrencyCode(trip.currency);

  switch (options.patternMode) {
    case "separateSheets": {
      // Collect all unique pattern labels across all days
      const labelMap = new Map<string, Record<string, string | number>[]>();
      for (const day of trip.days) {
        for (const pattern of day.patterns) {
          const existing = labelMap.get(pattern.label) ?? [];
          existing.push(...buildScheduleRows(day, [pattern], fields, fl, loc, vl, cur));
          labelMap.set(pattern.label, existing);
        }
      }
      for (const [label, rows] of labelMap) {
        addRowsToWorksheet(wb, label, rows);
      }
      break;
    }
    case "patternColumn": {
      const rows = trip.days.flatMap((day) =>
        buildScheduleRows(day, day.patterns, fields, fl, loc, vl, cur),
      );
      addRowsToWorksheet(wb, sn.itinerary, rows);
      break;
    }
  }

  if (options.includeCandidates && trip.candidates.length > 0) {
    const candidateRows = buildCandidateRows(trip.candidates, fields, fl, loc, vl, cur);
    addRowsToWorksheet(wb, sn.candidates, candidateRows);
  }

  if (options.includeExpenses && options.expenseData && options.expenseData.expenses.length > 0) {
    const { headers: expenseHeaders, rows: expenseRows } = buildExpenseExport(
      options.expenseData,
      options.expenseLabels,
      vl,
    );
    addRowsToWorksheet(wb, sn.expenses, expenseRows, expenseHeaders);
  }

  const name = options.fileName || `${trip.title}_${toDateString(new Date())}`;
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

// --- CSV ---

export function escapeCSVValue(value: string | number, delimiter: CSVDelimiter = "comma"): string {
  const str = String(value);
  const sep = delimiter === "tab" ? "\t" : ",";
  if (str.includes('"') || str.includes(sep) || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCSV(
  headers: string[],
  rows: Record<string, string | number>[],
  delimiter: CSVDelimiter = "comma",
  lineEnding: CSVLineEnding = "crlf",
): string {
  const sep = delimiter === "tab" ? "\t" : ",";
  const eol = lineEnding === "lf" ? "\n" : "\r\n";
  const headerLine = headers.map((h) => escapeCSVValue(h, delimiter)).join(sep);
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCSVValue(row[h] ?? "", delimiter)).join(sep),
  );
  return [headerLine, ...dataLines].join(eol);
}

function downloadDelimitedText(
  content: string,
  fileName: string,
  bom: boolean = true,
  delimiter: CSVDelimiter = "comma",
): void {
  const prefix = bom ? "\uFEFF" : "";
  const mimeType = delimiter === "tab" ? "text/tab-separated-values" : "text/csv";
  const blob = new Blob([prefix + content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportTripToCSV(trip: TripResponse, options: ExportOptions): Promise<void> {
  const { delimiter, bom, lineEnding } = options.csvOptions ?? DEFAULT_CSV_OPTIONS;

  // CSV always uses patternColumn mode (no separate sheets)
  const fields =
    options.patternMode === "patternColumn"
      ? options.fields
      : options.fields.filter((f) => f !== "pattern");

  const fl = options.fieldLabels ?? DEFAULT_EXPORT_FIELD_LABELS;
  const loc = options.locale;
  const vl = options.valueLabels;
  const cur = toCurrencyCode(trip.currency);
  const sn = options.sheetNames ?? {
    itinerary: "Itinerary",
    candidates: "Candidates",
    expenses: "Expenses",
    csvCandidatesSeparator: "--- Candidates ---",
    csvExpensesSeparator: "--- Expenses ---",
  };

  const headers = fields.map((f) => fl[f]);
  const rows = trip.days.flatMap((day) =>
    buildScheduleRows(day, day.patterns, fields, fl, loc, vl, cur),
  );
  let csv = rowsToCSV(headers, rows, delimiter, lineEnding);

  const eol = lineEnding === "lf" ? "\n" : "\r\n";

  if (options.includeCandidates && trip.candidates.length > 0) {
    const candidateFields = filterCandidateFields(fields);
    const candidateHeaders = candidateFields.map((f) => fl[f]);
    const candidateRows = buildCandidateRows(trip.candidates, fields, fl, loc, vl, cur);
    csv += `${eol}${eol}${sn.csvCandidatesSeparator}${eol}${rowsToCSV(candidateHeaders, candidateRows, delimiter, lineEnding)}`;
  }

  if (options.includeExpenses && options.expenseData && options.expenseData.expenses.length > 0) {
    const { headers: expenseHeaders, rows: expenseRows } = buildExpenseExport(
      options.expenseData,
      options.expenseLabels,
      vl,
    );
    csv += `${eol}${eol}${sn.csvExpensesSeparator}${eol}${rowsToCSV(expenseHeaders, expenseRows, delimiter, lineEnding)}`;
  }

  const name = options.fileName || `${trip.title}_${toDateString(new Date())}`;
  const ext = delimiter === "tab" ? "tsv" : "csv";
  downloadDelimitedText(csv, `${name}.${ext}`, bom, delimiter);
}

// --- iCal (.ics) ---

/** Escape a text value per RFC 5545 (backslash, semicolon, comma, newline). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

// JST(+09:00) is the fixed app timezone. Converting to UTC lets us emit "...Z"
// timestamps with no VTIMEZONE block, which Google/Apple Calendar interpret
// correctly. Schedule times have no stored timezone, so JST is assumed.
const JST_OFFSET_HOURS = 9;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcStamp(dt: Date): string {
  return (
    `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}` +
    `T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`
  );
}

/** "2025-04-01" + "09:00" (JST) -> "20250401T000000Z" (UTC basic format). */
function toIcsUtcStamp(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  // time may be "HH:MM" or "HH:MM:SS" (PostgreSQL time type); keep seconds.
  const [h, mi, s = 0] = time.split(":").map(Number);
  return formatUtcStamp(new Date(Date.UTC(y, mo - 1, d, h - JST_OFFSET_HOURS, mi, s)));
}

/** "2025-04-01" + offsetDays -> "20250402" (date-only, for all-day events). */
function toIcsDate(date: string, offsetDays = 0): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + offsetDays));
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}`;
}

/** Shift a "YYYY-MM-DD" string by whole days, keeping the same format. */
function shiftDateString(date: string, offsetDays: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + offsetDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** The default pattern of a day (isDefault, else the lowest sortOrder). */
function pickDefaultPattern(day: DayResponse): DayPatternResponse | undefined {
  return (
    day.patterns.find((p) => p.isDefault) ??
    [...day.patterns].sort((a, b) => a.sortOrder - b.sortOrder)[0]
  );
}

function scheduleToVevent(schedule: ScheduleResponse, day: DayResponse, stamp: string): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${schedule.id}@sugara`, `DTSTAMP:${stamp}`];
  const offset = schedule.endDayOffset ?? 0;

  if (!schedule.startTime && !schedule.endTime) {
    // All-day event. DTEND is exclusive: the day after the last covered day.
    lines.push(`DTSTART;VALUE=DATE:${toIcsDate(day.date)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcsDate(day.date, offset + 1)}`);
  } else {
    const start = schedule.startTime ?? schedule.endTime;
    if (!start) return [];
    lines.push(`DTSTART:${toIcsUtcStamp(day.date, start)}`);
    const end = schedule.endTime
      ? toIcsUtcStamp(shiftDateString(day.date, offset), schedule.endTime)
      : toIcsUtcStamp(day.date, start);
    lines.push(`DTEND:${end}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(schedule.name)}`);
  if (schedule.address) lines.push(`LOCATION:${escapeIcsText(schedule.address)}`);
  const descParts = [schedule.memo, ...schedule.urls].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (descParts.length > 0) {
    lines.push(`DESCRIPTION:${escapeIcsText(descParts.join("\n"))}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Build an iCalendar (.ics) document for a trip's default-pattern schedules.
 * Only the default pattern of each day is emitted; mixing alternate patterns
 * into one calendar would surface duplicate, overlapping events.
 */
export function buildIcsContent(trip: TripResponse, now: Date = new Date()): string {
  const stamp = formatUtcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sugara//Trip Export//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const day of trip.days) {
    const pattern = pickDefaultPattern(day);
    if (!pattern) continue;
    const sorted = [...pattern.schedules].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const schedule of sorted) {
      lines.push(...scheduleToVevent(schedule, day, stamp));
    }
  }
  lines.push("END:VCALENDAR");
  // Trailing CRLF is required by RFC 5545 §3.4; strict parsers (Apple Calendar)
  // reject content without it.
  return `${lines.join("\r\n")}\r\n`;
}

export async function exportTripToIcal(trip: TripResponse, options: ExportOptions): Promise<void> {
  const content = buildIcsContent(trip);
  const name = options.fileName || `${trip.title}_${toDateString(new Date())}`;
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportTrip(trip: TripResponse, options: ExportOptions): Promise<void> {
  if (options.format === "ics") {
    return exportTripToIcal(trip, options);
  }
  if (options.format === "csv") {
    return exportTripToCSV(trip, options);
  }
  return exportTripToExcel(trip, options);
}
