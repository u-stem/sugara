"use client";

import type { ExpensesResponse, TripResponse } from "@sugara/shared";
import { toCurrencyCode } from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, Download, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { pageTitle } from "@/lib/constants";
import {
  buildCandidateRows,
  buildDefaultFileName,
  buildExpenseExport,
  buildScheduleRows,
  type CSVDelimiter,
  type CSVLineEnding,
  DEFAULT_CSV_OPTIONS,
  EXPORT_FIELDS,
  type ExpenseExportData,
  type ExpenseExportLabels,
  type ExportField,
  type ExportFieldLabels,
  type ExportFormat,
  type ExportSheetNames,
  exportTrip,
  filterCandidateFields,
  type PatternMode,
  type ValueLabels,
} from "@/lib/export";
import { useAuthRedirect } from "@/lib/hooks/use-auth-redirect";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
};

function toExpenseExportData(
  data: ExpensesResponse,
  translateCategory?: (key: string) => string,
): ExpenseExportData {
  return {
    expenses: data.expenses.map((e) => ({
      title: e.title,
      amount: e.amount,
      paidByName: e.paidByUser.name,
      splitType: e.splitType,
      category: e.category
        ? translateCategory
          ? translateCategory(e.category)
          : e.category
        : null,
      splits: e.splits.map((s) => ({ name: s.user.name, amount: s.amount })),
    })),
    settlement: {
      totalAmount: data.settlement.totalAmount,
      balances: data.settlement.balances.map((b) => ({
        name: b.name,
        net: b.net,
      })),
      transfers: data.settlement.transfers.map((t) => ({
        fromName: t.from.name,
        toName: t.to.name,
        amount: t.amount,
      })),
    },
  };
}

function ExportSkeleton() {
  return (
    <div className="px-4 pt-4 space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="grid grid-cols-2 gap-3">
        {["f1", "f2", "f3", "f4", "f5", "f6"].map((key) => (
          <Skeleton key={key} className="h-6 w-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}

export default function SpTripExportPage() {
  const locale = useLocale();
  const tm = useTranslations("messages");
  const te = useTranslations("exportPage");
  const tel = useTranslations("exportLabels");
  const tlCat = useTranslations("labels.category");
  const tlTransport = useTranslations("labels.transportMethod");
  const tlSplit = useTranslations("labels.splitType");
  const tlExpCat = useTranslations("labels.expenseCategory");
  const tex = useTranslations("export");

  const valueLabels: ValueLabels = {
    category: (k) => (tlCat as (k: string) => string)(k),
    transportMethod: (k) => (tlTransport as (k: string) => string)(k),
    splitType: (k) => (tlSplit as (k: string) => string)(k),
    expenseCategory: (k) => (tlExpCat as (k: string) => string)(k),
  };

  const fieldLabels: ExportFieldLabels = {
    date: tel("date"),
    dayNumber: tel("dayNumber"),
    startTime: tel("startTime"),
    endTime: tel("endTime"),
    name: tel("name"),
    category: tel("category"),
    address: tel("address"),
    departurePlace: tel("departurePlace"),
    arrivalPlace: tel("arrivalPlace"),
    transportMethod: tel("transportMethod"),
    cost: tel("cost"),
    urls: tel("urls"),
    memo: tel("memo"),
    pattern: tel("pattern"),
  };

  const expenseLabels: ExpenseExportLabels = {
    title: tel("expenseTitle"),
    category: tel("expenseCategory"),
    amount: tel("expenseAmount"),
    paidBy: tel("expensePaidBy"),
    splitType: tel("expenseSplitType"),
    total: tel("total"),
    balanceSection: tel("balanceSection"),
    settlementSection: tel("settlementSection"),
    transferArrow: (from, to) => tel("transferArrow", { from, to }),
  };

  const exportSheetNames: ExportSheetNames = {
    itinerary: tex("sheetItinerary"),
    candidates: tex("sheetCandidates"),
    expenses: tex("sheetExpenses"),
    csvCandidatesSeparator: tel("csvCandidatesSeparator"),
    csvExpensesSeparator: tel("csvExpensesSeparator"),
  };

  const params = useParams();
  const tripId = typeof params.id === "string" ? params.id : null;

  const {
    data: trip,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.trips.detail(tripId ?? ""),
    queryFn: () => api<TripResponse>(`/api/trips/${tripId}`),
    enabled: tripId !== null,
  });
  const { data: expensesData } = useQuery({
    queryKey: queryKeys.expenses.list(tripId ?? ""),
    queryFn: () => api<ExpensesResponse>(`/api/trips/${tripId}/expenses`),
    enabled: tripId !== null,
  });

  useAuthRedirect(error);

  useEffect(() => {
    if (trip) {
      document.title = pageTitle(`${trip.title}${te("titleSuffix")}`);
    }
  }, [trip?.title]);

  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [selectedFields, setSelectedFields] = useState<ExportField[]>([]);
  const [patternMode, setPatternMode] = useState<PatternMode>("separateSheets");
  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [includeExpenses, setIncludeExpenses] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [delimiter, setDelimiter] = useState<CSVDelimiter>(DEFAULT_CSV_OPTIONS.delimiter);
  const [bom, setBom] = useState(DEFAULT_CSV_OPTIONS.bom);
  const [lineEnding, setLineEnding] = useState<CSVLineEnding>(DEFAULT_CSV_OPTIONS.lineEnding);

  useEffect(() => {
    if (trip && !fileName) {
      setFileName(buildDefaultFileName(trip.title));
    }
  }, [trip, fileName]);

  const selectedSet = useMemo(() => new Set(selectedFields), [selectedFields]);

  const toggleField = useCallback((field: ExportField) => {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  }, []);

  function selectAll() {
    setSelectedFields([...EXPORT_FIELDS]);
  }

  function resetToDefault() {
    setSelectedFields([]);
  }

  const effectivePatternMode = format === "csv" ? "patternColumn" : patternMode;

  function handleFormatChange(newFormat: ExportFormat) {
    setFormat(newFormat);
    if (newFormat === "csv" && patternMode === "separateSheets") {
      setPatternMode("patternColumn");
      if (!selectedFields.includes("pattern")) {
        setSelectedFields((prev) => [...prev, "pattern"]);
      }
    }
  }

  function handlePatternModeChange(mode: PatternMode) {
    setPatternMode(mode);
    if (mode === "patternColumn" && !selectedFields.includes("pattern")) {
      setSelectedFields((prev) => [...prev, "pattern"]);
    }
  }

  const effectiveFields = useMemo(
    () =>
      effectivePatternMode === "patternColumn"
        ? selectedFields
        : selectedFields.filter((f) => f !== "pattern"),
    [selectedFields, effectivePatternMode],
  );

  const [activeSheet, setActiveSheet] = useState("");

  type SheetData = {
    fields: ExportField[];
    rows: Record<string, string | number>[];
  };

  const previewSheets = useMemo(() => {
    if (!trip || effectiveFields.length === 0) return new Map<string, SheetData>();

    const sheets = new Map<string, SheetData>();
    const currency = toCurrencyCode(trip.currency);

    if (effectivePatternMode === "separateSheets") {
      for (const day of trip.days) {
        for (const pattern of day.patterns) {
          const existing = sheets.get(pattern.label);
          if (existing) {
            existing.rows.push(
              ...buildScheduleRows(
                day,
                [pattern],
                effectiveFields,
                fieldLabels,
                locale,
                valueLabels,
                currency,
              ),
            );
          } else {
            sheets.set(pattern.label, {
              fields: effectiveFields,
              rows: buildScheduleRows(
                day,
                [pattern],
                effectiveFields,
                fieldLabels,
                locale,
                valueLabels,
                currency,
              ),
            });
          }
        }
      }
    } else {
      const rows = trip.days.flatMap((day) =>
        buildScheduleRows(
          day,
          day.patterns,
          effectiveFields,
          fieldLabels,
          locale,
          valueLabels,
          currency,
        ),
      );
      sheets.set(exportSheetNames.itinerary, { fields: effectiveFields, rows });
    }

    if (includeCandidates && trip.candidates.length > 0) {
      const candidateFields = filterCandidateFields(effectiveFields);
      sheets.set(exportSheetNames.candidates, {
        fields: candidateFields,
        rows: buildCandidateRows(
          trip.candidates,
          effectiveFields,
          fieldLabels,
          locale,
          valueLabels,
          currency,
        ),
      });
    }

    return sheets;
  }, [trip, effectiveFields, effectivePatternMode, includeCandidates, locale]);

  const expenseExportData = useMemo(
    () => (expensesData ? toExpenseExportData(expensesData, valueLabels.expenseCategory) : null),
    [expensesData],
  );

  const expensePreviewData = useMemo(() => {
    if (!includeExpenses || !expenseExportData || expenseExportData.expenses.length === 0) {
      return null;
    }
    return buildExpenseExport(expenseExportData, expenseLabels, valueLabels);
  }, [includeExpenses, expenseExportData, expenseLabels]);

  const sheetNames = useMemo(() => {
    const names = [...previewSheets.keys()];
    if (expensePreviewData) names.push(exportSheetNames.expenses);
    return names;
  }, [previewSheets, expensePreviewData]);

  const showSheetTabs = format !== "csv" && sheetNames.length > 1;

  useEffect(() => {
    if (sheetNames.length > 0 && !sheetNames.includes(activeSheet)) {
      setActiveSheet(sheetNames[0]);
    }
  }, [sheetNames, activeSheet]);

  const activeSheetData = previewSheets.get(activeSheet);
  const activeFields = activeSheetData?.fields ?? [];
  const activeRows = activeSheetData?.rows ?? [];

  const candidateSheetData =
    format === "csv" ? previewSheets.get(exportSheetNames.candidates) : undefined;
  const expenseInlineData = format === "csv" ? expensePreviewData : undefined;

  const fileExtension =
    format === "csv" && delimiter === "tab" ? ".tsv" : format === "csv" ? ".csv" : ".xlsx";

  async function handleExport() {
    if (!trip) return;
    setExporting(true);
    try {
      await exportTrip(trip, {
        format,
        fields: effectiveFields,
        patternMode: effectivePatternMode,
        includeCandidates,
        includeExpenses,
        expenseData: includeExpenses && expenseExportData ? expenseExportData : undefined,
        fileName: fileName.trim() || undefined,
        csvOptions: format === "csv" ? { delimiter, bom, lineEnding } : undefined,
        fieldLabels,
        expenseLabels,
        sheetNames: exportSheetNames,
        locale,
        valueLabels,
      });
      toast.success(tm("exportSuccess"));
    } catch {
      toast.error(tm("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <LoadingBoundary isLoading={isLoading} skeleton={<ExportSkeleton />}>
      {error ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-destructive">{tm("tripFetchFailed")}</p>
        </div>
      ) : trip ? (
        <div className="px-4 pt-4 pb-24 space-y-6">
          <div className="flex items-center gap-2">
            <Link href={`/sp/trips/${tripId}`} className="shrink-0 text-muted-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="flex-1 truncate text-lg font-semibold">{trip.title}</h1>
            <Button
              size="sm"
              className="shrink-0"
              onClick={handleExport}
              disabled={effectiveFields.length === 0 || exporting}
            >
              <Download className="h-4 w-4" />
              {exporting ? tex("exporting") : tex("exportButton")}
            </Button>
          </div>

          {/* Format selection */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="export-format">{te("formatLabel")}</Label>
            <Select value={format} onValueChange={handleFormatChange}>
              <SelectTrigger id="export-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(FORMAT_LABELS) as [ExportFormat, string][]).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Field selection */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>{te("columnsLabel")}</Label>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={selectAll}>
                  <CheckCheck className="h-3.5 w-3.5" />
                  {te("selectAll")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetToDefault}
                  disabled={selectedFields.length === 0}
                >
                  <X className="h-3.5 w-3.5" />
                  {te("deselectAll")}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {EXPORT_FIELDS.map((field) => {
                const disabled = field === "pattern" && effectivePatternMode !== "patternColumn";
                const active = selectedSet.has(field) && !disabled;
                const id = `export-field-${field}`;
                return (
                  <div
                    key={field}
                    className={cn(
                      "flex select-none items-center gap-2 text-sm",
                      disabled && "opacity-40",
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={active}
                      disabled={disabled}
                      onCheckedChange={() => toggleField(field)}
                    />
                    <Label htmlFor={id} className="flex-1 font-normal">
                      {fieldLabels[field]}
                    </Label>
                    <span
                      className={cn(
                        "flex h-5 min-w-5 items-center justify-center rounded-full text-xs",
                        active ? "bg-muted text-muted-foreground" : "invisible",
                      )}
                    >
                      {active ? effectiveFields.indexOf(field) + 1 : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pattern mode */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="export-pattern-mode">{te("patternLabel")}</Label>
            <Select
              value={effectivePatternMode}
              onValueChange={handlePatternModeChange}
              disabled={format === "csv"}
            >
              <SelectTrigger id="export-pattern-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="separateSheets">{te("patternSeparateSheets")}</SelectItem>
                <SelectItem value="patternColumn">{te("patternSingleSheet")}</SelectItem>
              </SelectContent>
            </Select>
            {format === "csv" && (
              <p className="text-xs text-muted-foreground">{te("csvNoSheetSplit")}</p>
            )}
          </div>

          {/* CSV options */}
          {format === "csv" && (
            <div className="flex flex-col gap-3">
              <Label>{te("csvSettings")}</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="csv-delimiter" className="text-xs text-muted-foreground">
                    {te("delimiterLabel")}
                  </Label>
                  <Select value={delimiter} onValueChange={(v) => setDelimiter(v as CSVDelimiter)}>
                    <SelectTrigger id="csv-delimiter" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comma">{te("delimiterComma")}</SelectItem>
                      <SelectItem value="tab">{te("delimiterTab")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="csv-line-ending" className="text-xs text-muted-foreground">
                    {te("lineEndingLabel")}
                  </Label>
                  <Select
                    value={lineEnding}
                    onValueChange={(v) => setLineEnding(v as CSVLineEnding)}
                  >
                    <SelectTrigger id="csv-line-ending" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="crlf">CRLF (Windows)</SelectItem>
                      <SelectItem value="lf">LF (Mac/Linux)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="csv-bom"
                  checked={bom}
                  onCheckedChange={(checked) => setBom(checked === true)}
                />
                <Label htmlFor="csv-bom" className="select-none font-normal">
                  {te("bomLabel")}
                </Label>
              </div>
            </div>
          )}

          {/* Candidates */}
          {trip.candidates.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="export-include-candidates"
                checked={includeCandidates}
                onCheckedChange={(checked) => setIncludeCandidates(checked === true)}
              />
              <Label htmlFor="export-include-candidates" className="select-none">
                {te("includeCandidates", { count: trip.candidates.length })}
              </Label>
            </div>
          )}

          {/* Expenses */}
          {expensesData && expensesData.expenses.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="export-include-expenses"
                checked={includeExpenses}
                onCheckedChange={(checked) => setIncludeExpenses(checked === true)}
              />
              <Label htmlFor="export-include-expenses" className="select-none">
                {te("includeExpenses", { count: expensesData.expenses.length })}
              </Label>
            </div>
          )}

          {/* File name + Export button */}
          <div className="flex items-center gap-2">
            <Input
              id="export-filename"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder={tex("filenamePlaceholder")}
              className="flex-1"
            />
            <span className="shrink-0 text-sm text-muted-foreground">{fileExtension}</span>
          </div>
          {/* Preview */}
          {effectiveFields.length > 0 && (
            <div className="rounded-lg border">
              {showSheetTabs && (
                <div className="flex border-b bg-muted/30 px-2 pt-2">
                  {sheetNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={cn(
                        "rounded-t-md px-3 py-1.5 text-sm transition-colors",
                        name === activeSheet
                          ? "-mb-px border border-b-0 bg-background font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setActiveSheet(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto overscroll-x-contain">
                {activeSheet === exportSheetNames.expenses && expensePreviewData ? (
                  <ExpensePreviewTable data={expensePreviewData} />
                ) : activeFields.length > 0 && activeRows.length > 0 ? (
                  <>
                    <table className="text-xs">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {activeFields.map((field) => (
                            <th
                              key={field}
                              className="whitespace-nowrap px-3 py-2 text-left font-medium"
                            >
                              {fieldLabels[field]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeRows.map((row, index) => {
                          const nameLabel = fieldLabels.name;
                          const rowKey = `${activeSheet}-${row[nameLabel]}-${index}`;
                          return (
                            <tr key={rowKey} className="border-b last:border-b-0">
                              {activeFields.map((field) => (
                                <td
                                  key={field}
                                  className={cn(
                                    "px-3 py-1.5",
                                    field === "urls" || field === "memo"
                                      ? "whitespace-pre"
                                      : "h-8 max-w-[200px] whitespace-nowrap truncate",
                                  )}
                                >
                                  {row[fieldLabels[field]] ?? ""}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {candidateSheetData && candidateSheetData.rows.length > 0 && (
                      <>
                        <div className="border-t px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                          {exportSheetNames.csvCandidatesSeparator}
                        </div>
                        <table className="text-xs">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              {candidateSheetData.fields.map((field) => (
                                <th
                                  key={field}
                                  className="whitespace-nowrap px-3 py-2 text-left font-medium"
                                >
                                  {fieldLabels[field]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {candidateSheetData.rows.map((row, index) => {
                              const nameLabel = fieldLabels.name;
                              const rowKey = `candidate-${row[nameLabel]}-${index}`;
                              return (
                                <tr key={rowKey} className="border-b last:border-b-0">
                                  {candidateSheetData.fields.map((field) => (
                                    <td
                                      key={field}
                                      className={cn(
                                        "px-3 py-1.5",
                                        field === "urls" || field === "memo"
                                          ? "whitespace-pre"
                                          : "h-8 max-w-[200px] whitespace-nowrap truncate",
                                      )}
                                    >
                                      {row[fieldLabels[field]] ?? ""}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                    {expenseInlineData && (
                      <>
                        <div className="border-t px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                          {exportSheetNames.csvExpensesSeparator}
                        </div>
                        <ExpensePreviewTable data={expenseInlineData} />
                      </>
                    )}
                  </>
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    {tm("emptyExportSheet")}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </LoadingBoundary>
  );
}

function ExpensePreviewTable({
  data,
}: {
  data: { headers: string[]; rows: Record<string, string | number>[] };
}) {
  return (
    <table className="text-xs">
      <thead>
        <tr className="border-b bg-muted/50">
          {data.headers.map((header) => (
            <th key={header} className="whitespace-nowrap px-3 py-2 text-left font-medium">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, index) => {
          const rowKey = `expense-${row[data.headers[0]]}-${index}`;
          return (
            <tr key={rowKey} className="border-b last:border-b-0">
              {data.headers.map((header) => (
                <td
                  key={header}
                  className="h-8 max-w-[200px] whitespace-nowrap truncate px-3 py-1.5"
                >
                  {row[header] ?? ""}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
