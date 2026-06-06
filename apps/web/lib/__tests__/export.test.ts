import type {
  CandidateResponse,
  DayPatternResponse,
  DayResponse,
  ScheduleResponse,
  TripResponse,
} from "@sugara/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCandidateRows,
  buildDefaultFileName,
  buildExpenseExport,
  buildPreviewRows,
  buildScheduleRows,
  DEFAULT_CSV_OPTIONS,
  DEFAULT_SELECTED_FIELDS,
  EXPENSE_EXPORT_HEADERS,
  EXPORT_FIELD_LABELS,
  EXPORT_FIELDS,
  type ExpenseExportData,
  type ExportField,
  type ExportOptions,
  escapeCSVValue,
  exportTripToCSV,
  exportTripToExcel,
  filterCandidateFields,
  rowsToCSV,
  scheduleToRow,
  type ValueLabels,
} from "../export";

function makeSchedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: "s1",
    name: "Tokyo Tower",
    category: "sightseeing",
    address: "Tokyo, Japan",
    startTime: "09:00",
    endTime: "11:00",
    sortOrder: 0,
    memo: "Great view",
    urls: ["https://example.com"],
    departurePlace: "Hotel",
    arrivalPlace: "Tokyo Tower",
    transportMethod: "train",
    color: "blue",
    endDayOffset: null,
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDay(overrides: Partial<DayResponse> = {}): DayResponse {
  return {
    id: "d1",
    dayNumber: 1,
    date: "2025-04-01",
    memo: null,
    patterns: [
      {
        id: "p1",
        label: "Default",
        isDefault: true,
        sortOrder: 0,
        schedules: [makeSchedule()],
      },
    ],
    ...overrides,
  };
}

function makeTrip(overrides: Partial<TripResponse> = {}): TripResponse {
  return {
    id: "t1",
    title: "Tokyo Trip",
    destination: "Tokyo",
    startDate: "2025-04-01",
    endDate: "2025-04-03",
    status: "planned",
    coverImageUrl: null,
    coverImagePosition: 50,
    shareToken: null,
    currency: "JPY",
    role: "owner",
    days: [makeDay()],
    candidates: [],
    scheduleCount: 1,
    expenseCount: 0,
    memberCount: 1,
    poll: null,
    mapsEnabled: false,
    ...overrides,
  };
}

const CATEGORY_MAP: Record<string, string> = {
  sightseeing: "Sightseeing",
  restaurant: "Dining",
  hotel: "Accommodation",
  transport: "Transport",
  activity: "Activity",
  other: "Other",
};
const TRANSPORT_MAP: Record<string, string> = {
  train: "Train",
  shinkansen: "Shinkansen",
  bus: "Bus",
  taxi: "Taxi",
  walk: "Walk",
  car: "Car",
  airplane: "Airplane",
};
const SPLIT_MAP: Record<string, string> = {
  equal: "Equal",
  custom: "Custom",
  itemized: "Itemized",
};
const EXP_CAT_MAP: Record<string, string> = {
  transportation: "Transportation",
  accommodation: "Accommodation",
  meals: "Meals",
  other: "Other",
};

function makeValueLabels(): ValueLabels {
  return {
    category: (k) => CATEGORY_MAP[k] ?? k,
    transportMethod: (k) => TRANSPORT_MAP[k] ?? k,
    splitType: (k) => SPLIT_MAP[k] ?? k,
    expenseCategory: (k) => EXP_CAT_MAP[k] ?? k,
  };
}

describe("EXPORT_FIELDS / EXPORT_FIELD_LABELS", () => {
  it("has 14 fields defined", () => {
    expect(EXPORT_FIELDS).toHaveLength(14);
  });

  it("has a Japanese label for every field", () => {
    for (const field of EXPORT_FIELDS) {
      expect(EXPORT_FIELD_LABELS[field]).toBeDefined();
      expect(typeof EXPORT_FIELD_LABELS[field]).toBe("string");
    }
  });

  it("DEFAULT_SELECTED_FIELDS is a subset of EXPORT_FIELDS", () => {
    for (const field of DEFAULT_SELECTED_FIELDS) {
      expect(EXPORT_FIELDS).toContain(field);
    }
  });
});

describe("scheduleToRow", () => {
  it("selects only requested fields", () => {
    const schedule = makeSchedule();
    const day = makeDay();
    const fields: ExportField[] = ["name", "address"];
    const row = scheduleToRow(schedule, day, null, fields);

    expect(Object.keys(row)).toEqual([EXPORT_FIELD_LABELS.name, EXPORT_FIELD_LABELS.address]);
    expect(row[EXPORT_FIELD_LABELS.name]).toBe("Tokyo Tower");
    expect(row[EXPORT_FIELD_LABELS.address]).toBe("Tokyo, Japan");
  });

  it("returns raw category when no valueLabels provided", () => {
    const schedule = makeSchedule({ category: "restaurant" });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["category"]);

    expect(row[EXPORT_FIELD_LABELS.category]).toBe("restaurant");
  });

  it("translates category when valueLabels provided", () => {
    const schedule = makeSchedule({ category: "restaurant" });
    const day = makeDay();
    const vl = makeValueLabels();
    const row = scheduleToRow(schedule, day, null, ["category"], undefined, undefined, vl);

    expect(row[EXPORT_FIELD_LABELS.category]).toBe("Dining");
  });

  it("returns raw transportMethod when no valueLabels provided", () => {
    const schedule = makeSchedule({ transportMethod: "shinkansen" });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["transportMethod"]);

    expect(row[EXPORT_FIELD_LABELS.transportMethod]).toBe("shinkansen");
  });

  it("translates transportMethod when valueLabels provided", () => {
    const schedule = makeSchedule({ transportMethod: "shinkansen" });
    const day = makeDay();
    const vl = makeValueLabels();
    const row = scheduleToRow(schedule, day, null, ["transportMethod"], undefined, undefined, vl);

    expect(row[EXPORT_FIELD_LABELS.transportMethod]).toBe("Shinkansen");
  });

  it("formats date to Japanese format", () => {
    const schedule = makeSchedule();
    const day = makeDay({ date: "2025-04-01" });
    const row = scheduleToRow(schedule, day, null, ["date"]);

    expect(row[EXPORT_FIELD_LABELS.date]).toBe("2025年4月1日");
  });

  it("formats time to HH:MM", () => {
    const schedule = makeSchedule({ startTime: "09:00:00", endTime: "11:30:00" });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["startTime", "endTime"]);

    expect(row[EXPORT_FIELD_LABELS.startTime]).toBe("09:00");
    expect(row[EXPORT_FIELD_LABELS.endTime]).toBe("11:30");
  });

  it("handles null/undefined fields as empty string", () => {
    const schedule = makeSchedule({
      address: null,
      startTime: null,
      memo: null,
      urls: [],
      transportMethod: null,
    });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, [
      "address",
      "startTime",
      "memo",
      "urls",
      "transportMethod",
    ]);

    expect(row[EXPORT_FIELD_LABELS.address]).toBe("");
    expect(row[EXPORT_FIELD_LABELS.startTime]).toBe("");
    expect(row[EXPORT_FIELD_LABELS.memo]).toBe("");
    expect(row[EXPORT_FIELD_LABELS.urls]).toBe("");
    expect(row[EXPORT_FIELD_LABELS.transportMethod]).toBe("");
  });

  it("joins multiple urls with newline", () => {
    const schedule = makeSchedule({
      urls: ["https://example.com", "https://maps.google.com"],
    });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["urls"]);

    expect(row[EXPORT_FIELD_LABELS.urls]).toBe("https://example.com\nhttps://maps.google.com");
  });

  it("formats transport cost in the trip currency (whole units, no minor scaling)", () => {
    const schedule = makeSchedule({ category: "transport", cost: 580 });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["cost"], undefined, "ja", undefined, "JPY");

    // Whole-unit: 580 -> ¥580, not ¥5.80. The yen sign may be half-width (¥) or
    // full-width (￥) depending on the ICU/Node version, so match either.
    expect(row[EXPORT_FIELD_LABELS.cost]).toMatch(/^[¥￥]580$/);
  });

  it("formats transport cost for non-JPY currency without cent scaling", () => {
    const schedule = makeSchedule({ category: "transport", cost: 580 });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["cost"], undefined, "en", undefined, "USD");

    expect(row[EXPORT_FIELD_LABELS.cost]).toBe("$580");
  });

  it("leaves cost blank for non-transport rows even when cost is set", () => {
    const schedule = makeSchedule({ category: "sightseeing", cost: 580 });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["cost"], undefined, "ja", undefined, "JPY");

    expect(row[EXPORT_FIELD_LABELS.cost]).toBe("");
  });

  it("leaves cost blank when cost is null", () => {
    const schedule = makeSchedule({ category: "transport", cost: null });
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["cost"], undefined, "ja", undefined, "JPY");

    expect(row[EXPORT_FIELD_LABELS.cost]).toBe("");
  });

  it("includes dayNumber", () => {
    const schedule = makeSchedule();
    const day = makeDay({ dayNumber: 3 });
    const row = scheduleToRow(schedule, day, null, ["dayNumber"]);

    expect(row[EXPORT_FIELD_LABELS.dayNumber]).toBe(3);
  });

  it("includes pattern label when provided", () => {
    const schedule = makeSchedule();
    const day = makeDay();
    const row = scheduleToRow(schedule, day, "Rain Plan", ["pattern"]);

    expect(row[EXPORT_FIELD_LABELS.pattern]).toBe("Rain Plan");
  });

  it("uses empty string for pattern when null", () => {
    const schedule = makeSchedule();
    const day = makeDay();
    const row = scheduleToRow(schedule, day, null, ["pattern"]);

    expect(row[EXPORT_FIELD_LABELS.pattern]).toBe("");
  });
});

describe("buildScheduleRows", () => {
  it("returns rows sorted by sortOrder", () => {
    const patterns: DayPatternResponse[] = [
      {
        id: "p1",
        label: "Default",
        isDefault: true,
        sortOrder: 0,
        schedules: [
          makeSchedule({ id: "s1", name: "Second", sortOrder: 1 }),
          makeSchedule({ id: "s2", name: "First", sortOrder: 0 }),
        ],
      },
    ];
    const day = makeDay({ patterns });
    const rows = buildScheduleRows(day, patterns, ["name"]);

    expect(rows[0][EXPORT_FIELD_LABELS.name]).toBe("First");
    expect(rows[1][EXPORT_FIELD_LABELS.name]).toBe("Second");
  });

  it("handles multiple patterns (patternColumn mode)", () => {
    const patterns: DayPatternResponse[] = [
      {
        id: "p1",
        label: "Default",
        isDefault: true,
        sortOrder: 0,
        schedules: [makeSchedule({ id: "s1", name: "A" })],
      },
      {
        id: "p2",
        label: "Rain",
        isDefault: false,
        sortOrder: 1,
        schedules: [makeSchedule({ id: "s2", name: "B" })],
      },
    ];
    const day = makeDay({ patterns });
    const rows = buildScheduleRows(day, patterns, ["name", "pattern"]);

    expect(rows).toHaveLength(2);
    expect(rows[0][EXPORT_FIELD_LABELS.pattern]).toBe("Default");
    expect(rows[1][EXPORT_FIELD_LABELS.pattern]).toBe("Rain");
  });
});

describe("buildCandidateRows", () => {
  it("excludes day-context fields but keeps schedule properties", () => {
    const candidates: CandidateResponse[] = [
      {
        ...makeSchedule({ id: "c1", name: "Candidate 1", transportMethod: "train" }),
        likeCount: 0,
        hmmCount: 0,
        myReaction: null,
      },
    ];
    const fields: ExportField[] = ["date", "dayNumber", "name", "category", "transportMethod"];
    const rows = buildCandidateRows(candidates, fields);

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty(EXPORT_FIELD_LABELS.date);
    expect(rows[0]).not.toHaveProperty(EXPORT_FIELD_LABELS.dayNumber);
    expect(rows[0][EXPORT_FIELD_LABELS.name]).toBe("Candidate 1");
    expect(rows[0][EXPORT_FIELD_LABELS.transportMethod]).toBe("train");
  });
});

describe("filterCandidateFields", () => {
  it("removes only day-context fields (date, dayNumber, pattern)", () => {
    const all: ExportField[] = [
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
      "urls",
      "memo",
      "pattern",
    ];
    const filtered = filterCandidateFields(all);

    expect(filtered).toEqual([
      "startTime",
      "endTime",
      "name",
      "category",
      "address",
      "departurePlace",
      "arrivalPlace",
      "transportMethod",
      "urls",
      "memo",
    ]);
  });

  it("preserves order of remaining fields", () => {
    const fields: ExportField[] = ["memo", "name", "urls"];
    const filtered = filterCandidateFields(fields);

    expect(filtered).toEqual(["memo", "name", "urls"]);
  });
});

describe("buildPreviewRows", () => {
  it("returns at most 3 rows", () => {
    const patterns: DayPatternResponse[] = [
      {
        id: "p1",
        label: "Default",
        isDefault: true,
        sortOrder: 0,
        schedules: [
          makeSchedule({ id: "s1", name: "A", sortOrder: 0 }),
          makeSchedule({ id: "s2", name: "B", sortOrder: 1 }),
          makeSchedule({ id: "s3", name: "C", sortOrder: 2 }),
          makeSchedule({ id: "s4", name: "D", sortOrder: 3 }),
        ],
      },
    ];
    const trip = makeTrip({ days: [makeDay({ patterns })] });
    const rows = buildPreviewRows(trip, ["name"]);

    expect(rows).toHaveLength(3);
    expect(rows[0][EXPORT_FIELD_LABELS.name]).toBe("A");
    expect(rows[2][EXPORT_FIELD_LABELS.name]).toBe("C");
  });

  it("returns empty array for trip with no schedules", () => {
    const trip = makeTrip({
      days: [
        makeDay({
          patterns: [{ id: "p1", label: "Default", isDefault: true, sortOrder: 0, schedules: [] }],
        }),
      ],
    });
    const rows = buildPreviewRows(trip, ["name"]);

    expect(rows).toHaveLength(0);
  });
});

const { mockAddWorksheet, mockAddRow, mockWriteBuffer, mockWorkbookSheets } = vi.hoisted(() => {
  const mockAddRow = vi.fn();
  const mockWorkbookSheets: {
    name: string;
    columns: unknown[];
    rows: Record<string, unknown>[];
  }[] = [];
  const mockAddWorksheet = vi.fn((name: string) => {
    const sheet = { name, columns: [] as unknown[], rows: [] as Record<string, unknown>[] };
    mockWorkbookSheets.push(sheet);
    return {
      set columns(cols: unknown[]) {
        sheet.columns = cols;
      },
      addRow: (row: Record<string, unknown>) => {
        sheet.rows.push(row);
        mockAddRow(row);
      },
    };
  });
  const mockWriteBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0));
  return { mockAddWorksheet, mockAddRow, mockWriteBuffer, mockWorkbookSheets };
});

vi.mock("exceljs", () => ({
  Workbook: class {
    addWorksheet = mockAddWorksheet;
    xlsx = { writeBuffer: mockWriteBuffer };
  },
}));

describe("exportTripToExcel", () => {
  beforeEach(() => {
    mockAddWorksheet.mockClear();
    mockAddRow.mockClear();
    mockWriteBuffer.mockClear();
    mockWorkbookSheets.length = 0;

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("Blob", class {});
    const mockLink = { href: "", download: "", click: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);
  });

  function makeOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
    return {
      fields: ["name", "startTime", "endTime"],
      patternMode: "separateSheets",
      includeCandidates: false,
      includeExpenses: false,
      ...overrides,
    };
  }

  it("creates separate sheets for separateSheets mode", async () => {
    const trip = makeTrip({
      days: [
        makeDay({
          patterns: [
            {
              id: "p1",
              label: "Default",
              isDefault: true,
              sortOrder: 0,
              schedules: [makeSchedule()],
            },
            {
              id: "p2",
              label: "Rain",
              isDefault: false,
              sortOrder: 1,
              schedules: [makeSchedule({ id: "s2", name: "Indoor" })],
            },
          ],
        }),
      ],
    });

    await exportTripToExcel(trip, makeOptions({ patternMode: "separateSheets" }));

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).toContain("Default");
    expect(sheetNames).toContain("Rain");
  });

  it("creates a single sheet with pattern column for patternColumn mode", async () => {
    const trip = makeTrip({
      days: [
        makeDay({
          patterns: [
            {
              id: "p1",
              label: "Default",
              isDefault: true,
              sortOrder: 0,
              schedules: [makeSchedule()],
            },
            {
              id: "p2",
              label: "Rain",
              isDefault: false,
              sortOrder: 1,
              schedules: [makeSchedule({ id: "s2" })],
            },
          ],
        }),
      ],
    });

    await exportTripToExcel(
      trip,
      makeOptions({
        patternMode: "patternColumn",
        fields: ["name", "pattern"],
      }),
    );

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).toContain("Itinerary");
  });

  it("adds a candidates sheet when includeCandidates is true", async () => {
    const candidates: CandidateResponse[] = [
      {
        ...makeSchedule({ id: "c1", name: "Candidate" }),
        likeCount: 2,
        hmmCount: 1,
        myReaction: null,
      },
    ];
    const trip = makeTrip({ candidates });

    await exportTripToExcel(trip, makeOptions({ includeCandidates: true }));

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).toContain("Candidates");
  });

  it("does not add candidates sheet when includeCandidates is false", async () => {
    const candidates: CandidateResponse[] = [
      {
        ...makeSchedule({ id: "c1", name: "Candidate" }),
        likeCount: 0,
        hmmCount: 0,
        myReaction: null,
      },
    ];
    const trip = makeTrip({ candidates });

    await exportTripToExcel(trip, makeOptions({ includeCandidates: false }));

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).not.toContain("Candidates");
  });

  it("generates the correct file name", async () => {
    const trip = makeTrip({ title: "Tokyo Trip" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-04-15"));

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    await exportTripToExcel(trip, makeOptions());

    expect(mockLink.download).toBe("Tokyo Trip_2025-04-15.xlsx");

    vi.useRealTimers();
  });

  it("strips pattern field from fields when not in patternColumn mode", async () => {
    const trip = makeTrip();
    await exportTripToExcel(
      trip,
      makeOptions({
        patternMode: "separateSheets",
        fields: ["name", "pattern", "startTime"],
      }),
    );

    const sheet = mockWorkbookSheets[0];
    if (sheet && sheet.rows.length > 0) {
      expect(sheet.rows[0]).not.toHaveProperty(EXPORT_FIELD_LABELS.pattern);
    }
  });

  it("uses custom fileName when provided", async () => {
    const trip = makeTrip({ title: "Tokyo Trip" });

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    await exportTripToExcel(trip, makeOptions({ fileName: "my-custom-name" }));

    expect(mockLink.download).toBe("my-custom-name.xlsx");
  });
});

describe("buildDefaultFileName", () => {
  it("returns title with today's date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-04-15"));

    expect(buildDefaultFileName("Tokyo Trip")).toBe("Tokyo Trip_2025-04-15");

    vi.useRealTimers();
  });
});

describe("escapeCSVValue", () => {
  it("returns plain string as-is", () => {
    expect(escapeCSVValue("hello")).toBe("hello");
  });

  it("wraps value containing comma in double quotes", () => {
    expect(escapeCSVValue("a,b")).toBe('"a,b"');
  });

  it("wraps value containing newline in double quotes", () => {
    expect(escapeCSVValue("line1\nline2")).toBe('"line1\nline2"');
  });

  it("escapes double quotes by doubling them", () => {
    expect(escapeCSVValue('say "hi"')).toBe('"say ""hi"""');
  });

  it("handles value with both comma and double quotes", () => {
    expect(escapeCSVValue('a,"b"')).toBe('"a,""b"""');
  });

  it("converts number to string", () => {
    expect(escapeCSVValue(42)).toBe("42");
  });

  it("does not quote comma when delimiter is tab", () => {
    expect(escapeCSVValue("a,b", "tab")).toBe("a,b");
  });

  it("quotes value containing tab when delimiter is tab", () => {
    expect(escapeCSVValue("a\tb", "tab")).toBe('"a\tb"');
  });

  it("still quotes newline and double quotes when delimiter is tab", () => {
    expect(escapeCSVValue('say "hi"', "tab")).toBe('"say ""hi"""');
    expect(escapeCSVValue("line1\nline2", "tab")).toBe('"line1\nline2"');
  });
});

describe("rowsToCSV", () => {
  it("generates CSV with headers and rows", () => {
    const headers = ["Name", "Age"];
    const rows = [
      { Name: "Alice", Age: 30 },
      { Name: "Bob", Age: 25 },
    ];
    const csv = rowsToCSV(headers, rows);

    expect(csv).toBe("Name,Age\r\nAlice,30\r\nBob,25");
  });

  it("escapes values correctly in CSV output", () => {
    const headers = ["Name", "Memo"];
    const rows = [{ Name: "Place, A", Memo: 'say "hi"' }];
    const csv = rowsToCSV(headers, rows);

    expect(csv).toBe('Name,Memo\r\n"Place, A","say ""hi"""');
  });

  it("handles empty rows", () => {
    const headers = ["Name"];
    const rows: Record<string, string | number>[] = [];
    const csv = rowsToCSV(headers, rows);

    expect(csv).toBe("Name");
  });

  it("uses empty string for missing keys", () => {
    const headers = ["Name", "Address"];
    const rows = [{ Name: "A" }];
    const csv = rowsToCSV(headers, rows);

    expect(csv).toBe("Name,Address\r\nA,");
  });

  it("uses tab delimiter when specified", () => {
    const headers = ["Name", "Age"];
    const rows = [{ Name: "Alice", Age: 30 }];
    const csv = rowsToCSV(headers, rows, "tab");

    expect(csv).toBe("Name\tAge\r\nAlice\t30");
  });

  it("uses LF line ending when specified", () => {
    const headers = ["Name", "Age"];
    const rows = [
      { Name: "Alice", Age: 30 },
      { Name: "Bob", Age: 25 },
    ];
    const csv = rowsToCSV(headers, rows, "comma", "lf");

    expect(csv).toBe("Name,Age\nAlice,30\nBob,25");
  });

  it("combines tab delimiter with LF line ending", () => {
    const headers = ["Name"];
    const rows = [{ Name: "A" }, { Name: "B" }];
    const csv = rowsToCSV(headers, rows, "tab", "lf");

    expect(csv).toBe("Name\nA\nB");
  });
});

describe("exportTripToCSV", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("creates a BOM-prefixed CSV blob and triggers download", async () => {
    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-04-15"));

    await exportTripToCSV(trip, {
      fields: ["name", "startTime"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: false,
    });

    expect(mockLink.download).toBe("Tokyo Trip_2025-04-15.csv");
    expect(mockClick).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("uses custom fileName when provided", async () => {
    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: false,
      fileName: "custom",
    });

    expect(mockLink.download).toBe("custom.csv");
  });

  it("appends candidates after schedule rows with separator", async () => {
    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const candidates: CandidateResponse[] = [
      {
        ...makeSchedule({ id: "c1", name: "Candidate Spot" }),
        likeCount: 0,
        hmmCount: 0,
        myReaction: null,
      },
    ];
    const trip = makeTrip({ candidates });
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: true,
      includeExpenses: false,
    });

    // BOM prefix
    expect(capturedContent.charCodeAt(0)).toBe(0xfeff);
    // Contains candidate section
    expect(capturedContent).toContain("Candidates");
    expect(capturedContent).toContain("Candidate Spot");
  });

  it("omits BOM when csvOptions.bom is false", async () => {
    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: false,
      csvOptions: { ...DEFAULT_CSV_OPTIONS, bom: false },
    });

    expect(capturedContent.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("uses tab delimiter and downloads with .tsv extension", async () => {
    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();
    await exportTripToCSV(trip, {
      fields: ["name", "startTime"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: false,
      csvOptions: { delimiter: "tab", bom: true, lineEnding: "crlf" },
    });

    expect(mockLink.download).toMatch(/\.tsv$/);
    expect(capturedContent).toContain("\t");
    expect(capturedContent).not.toMatch(/Name,/);
  });

  it("uses LF line ending when specified", async () => {
    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: false,
      csvOptions: { delimiter: "comma", bom: true, lineEnding: "lf" },
    });

    // Strip BOM, then check line endings
    const withoutBom = capturedContent.slice(1);
    expect(withoutBom).not.toContain("\r\n");
    expect(withoutBom).toContain("\n");
  });

  it("uses candidate separator with correct line ending", async () => {
    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const candidates: CandidateResponse[] = [
      {
        ...makeSchedule({ id: "c1", name: "Candidate Spot" }),
        likeCount: 0,
        hmmCount: 0,
        myReaction: null,
      },
    ];
    const trip = makeTrip({ candidates });
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: true,
      includeExpenses: false,
      csvOptions: { delimiter: "comma", bom: false, lineEnding: "lf" },
    });

    expect(capturedContent).toContain("\n\n--- Candidates ---\n");
    expect(capturedContent).not.toContain("\r\n");
  });
});

// --- Expense export ---

function makeExpenseData(overrides: Partial<ExpenseExportData> = {}): ExpenseExportData {
  return {
    expenses: [
      {
        title: "夕食",
        amount: 5000,
        paidByName: "Alice",
        splitType: "equal",
        category: null,
        splits: [
          { name: "Alice", amount: 2500 },
          { name: "Bob", amount: 2500 },
        ],
      },
      {
        title: "タクシー",
        amount: 3000,
        paidByName: "Bob",
        splitType: "custom",
        category: "交通費",
        splits: [
          { name: "Alice", amount: 1000 },
          { name: "Bob", amount: 2000 },
        ],
      },
    ],
    settlement: {
      totalAmount: 8000,
      balances: [
        { name: "Alice", net: 1000 },
        { name: "Bob", net: -1000 },
      ],
      transfers: [{ fromName: "Bob", toName: "Alice", amount: 1000 }],
    },
    ...overrides,
  };
}

describe("buildExpenseExport", () => {
  it("returns expense rows with correct column values", () => {
    const data = makeExpenseData();
    const { headers, rows } = buildExpenseExport(data);

    expect(rows[0][EXPENSE_EXPORT_HEADERS.title]).toBe("夕食");
    expect(rows[0][EXPENSE_EXPORT_HEADERS.amount]).toBe(5000);
    expect(rows[0][EXPENSE_EXPORT_HEADERS.paidBy]).toBe("Alice");
    expect(rows[0][EXPENSE_EXPORT_HEADERS.splitType]).toBe("equal");

    expect(rows[1][EXPENSE_EXPORT_HEADERS.title]).toBe("タクシー");
    expect(rows[1][EXPENSE_EXPORT_HEADERS.splitType]).toBe("custom");

    // Member split columns
    expect(headers).toContain("Alice");
    expect(headers).toContain("Bob");
    expect(rows[0].Alice).toBe(2500);
    expect(rows[0].Bob).toBe(2500);
    expect(rows[1].Alice).toBe(1000);
    expect(rows[1].Bob).toBe(2000);
  });

  it("includes total row after expenses", () => {
    const data = makeExpenseData();
    const rows = buildExpenseExport(data).rows;

    const totalRow = rows.find((r) => r[EXPENSE_EXPORT_HEADERS.title] === "Total");
    expect(totalRow).toBeDefined();
    expect(totalRow?.[EXPENSE_EXPORT_HEADERS.amount]).toBe(8000);
  });

  it("includes balance section with non-zero balances", () => {
    const data = makeExpenseData();
    const rows = buildExpenseExport(data).rows;

    const sectionRow = rows.find((r) => r[EXPENSE_EXPORT_HEADERS.title] === "[Balance]");
    expect(sectionRow).toBeDefined();

    const aliceRow = rows.find(
      (r) =>
        r[EXPENSE_EXPORT_HEADERS.title] === "Alice" &&
        rows.indexOf(r) > rows.indexOf(sectionRow ?? {}),
    );
    expect(aliceRow).toBeDefined();
    expect(aliceRow?.[EXPENSE_EXPORT_HEADERS.amount]).toBe(1000);
  });

  it("includes transfer section", () => {
    const data = makeExpenseData();
    const rows = buildExpenseExport(data).rows;

    const sectionRow = rows.find((r) => r[EXPENSE_EXPORT_HEADERS.title] === "[Settlement]");
    expect(sectionRow).toBeDefined();

    const transferRow = rows.find((r) => String(r[EXPENSE_EXPORT_HEADERS.title]).includes("→"));
    expect(transferRow).toBeDefined();
    expect(transferRow?.[EXPENSE_EXPORT_HEADERS.title]).toBe("Bob → Alice");
    expect(transferRow?.[EXPENSE_EXPORT_HEADERS.amount]).toBe(1000);
  });

  it("sorts balances by net descending", () => {
    const data = makeExpenseData({
      settlement: {
        totalAmount: 9000,
        balances: [
          { name: "Charlie", net: -500 },
          { name: "Alice", net: 2000 },
          { name: "Bob", net: -1500 },
        ],
        transfers: [],
      },
    });
    const rows = buildExpenseExport(data).rows;

    const sectionIdx = rows.findIndex((r) => r[EXPENSE_EXPORT_HEADERS.title] === "[Balance]");
    const balanceRows = rows
      .slice(sectionIdx + 1)
      .filter(
        (r) =>
          r[EXPENSE_EXPORT_HEADERS.title] !== "" &&
          !String(r[EXPENSE_EXPORT_HEADERS.title]).startsWith("["),
      );
    expect(balanceRows[0][EXPENSE_EXPORT_HEADERS.title]).toBe("Alice");
    expect(balanceRows[1][EXPENSE_EXPORT_HEADERS.title]).toBe("Charlie");
    expect(balanceRows[2][EXPENSE_EXPORT_HEADERS.title]).toBe("Bob");
  });

  it("skips balance section when all balances are zero", () => {
    const data = makeExpenseData({
      settlement: {
        totalAmount: 4000,
        balances: [
          { name: "Alice", net: 0 },
          { name: "Bob", net: 0 },
        ],
        transfers: [],
      },
    });
    const rows = buildExpenseExport(data).rows;

    expect(rows.find((r) => r[EXPENSE_EXPORT_HEADERS.title] === "[Balance]")).toBeUndefined();
  });

  it("skips transfer section when no transfers", () => {
    const data = makeExpenseData({
      settlement: {
        totalAmount: 4000,
        balances: [{ name: "Alice", net: 0 }],
        transfers: [],
      },
    });
    const rows = buildExpenseExport(data).rows;

    expect(rows.find((r) => r[EXPENSE_EXPORT_HEADERS.title] === "[Settlement]")).toBeUndefined();
  });
});

describe("exportTripToExcel - expenses", () => {
  beforeEach(() => {
    mockAddWorksheet.mockClear();
    mockAddRow.mockClear();
    mockWriteBuffer.mockClear();
    mockWorkbookSheets.length = 0;

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("Blob", class {});
    const mockLink = { href: "", download: "", click: vi.fn() };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);
  });

  it("adds expense sheet when includeExpenses is true", async () => {
    const trip = makeTrip();
    await exportTripToExcel(trip, {
      fields: ["name"],
      patternMode: "separateSheets",
      includeCandidates: false,
      includeExpenses: true,
      expenseData: makeExpenseData(),
    });

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).toContain("Expenses");
  });

  it("does not add expense sheet when includeExpenses is false", async () => {
    const trip = makeTrip();
    await exportTripToExcel(trip, {
      fields: ["name"],
      patternMode: "separateSheets",
      includeCandidates: false,
      includeExpenses: false,
    });

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).not.toContain("Expenses");
  });

  it("does not add expense sheet when expenseData has no expenses", async () => {
    const trip = makeTrip();
    await exportTripToExcel(trip, {
      fields: ["name"],
      patternMode: "separateSheets",
      includeCandidates: false,
      includeExpenses: true,
      expenseData: makeExpenseData({ expenses: [] }),
    });

    const sheetNames = mockWorkbookSheets.map((s) => s.name);
    expect(sheetNames).not.toContain("Expenses");
  });
});

describe("exportTripToCSV - expenses", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("appends expense section when includeExpenses is true", async () => {
    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: true,
      expenseData: makeExpenseData(),
      csvOptions: { delimiter: "comma", bom: false, lineEnding: "lf" },
    });

    expect(capturedContent).toContain("--- Expenses ---");
    expect(capturedContent).toContain("夕食");
    expect(capturedContent).toContain("タクシー");
    expect(capturedContent).toContain("Total");
  });

  it("does not append expense section when includeExpenses is false", async () => {
    let capturedContent = "";
    vi.stubGlobal(
      "Blob",
      class {
        content: string;
        constructor(parts: string[]) {
          this.content = parts.join("");
          capturedContent = this.content;
        }
      },
    );

    const mockClick = vi.fn();
    const mockLink = { href: "", download: "", click: mockClick };
    vi.spyOn(document, "createElement").mockReturnValue(mockLink as unknown as HTMLElement);

    const trip = makeTrip();
    await exportTripToCSV(trip, {
      fields: ["name"],
      patternMode: "patternColumn",
      includeCandidates: false,
      includeExpenses: false,
      csvOptions: { delimiter: "comma", bom: false, lineEnding: "lf" },
    });

    expect(capturedContent).not.toContain("Expenses");
  });
});
