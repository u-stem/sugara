"use client";

import {
  CURRENCIES,
  type CurrencyCode,
  ERROR_CODE,
  MAX_TRIPS_PER_USER,
  TRIP_DESTINATION_MAX_LENGTH,
  TRIP_TITLE_MAX_LENGTH,
} from "@sugara/shared";
import { format } from "date-fns";
import { enUS, ja } from "date-fns/locale";
import { Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import { CalendarNav, END_YEAR, START_YEAR } from "@/components/calendar-nav";
import { CoverImagePicker } from "@/components/cover-image-picker";
import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api, getApiErrorMessage } from "@/lib/api";
import { formatDateRangeShort } from "@/lib/format";
import { useCoverImageUpload } from "@/lib/hooks/use-cover-image-upload";

type DateMode = "direct" | "poll";
type CandidateOption = { startDate: string; endDate: string };

type CreateTripDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

export function CreateTripDialog({ open, onOpenChange, onCreated }: CreateTripDialogProps) {
  const locale = useLocale();
  const calendarLocale = locale === "ja" ? ja : enUS;
  const tm = useTranslations("messages");
  const tt = useTranslations("trip");
  const tc = useTranslations("common");
  const [dateMode, setDateMode] = useState<DateMode>("direct");
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currency, setCurrency] = useState<CurrencyCode>("JPY");

  // Direct mode state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Cover image state
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPosition, setCoverPosition] = useState(50);
  const { uploading, error: uploadError, upload } = useCoverImageUpload();

  // Poll mode state
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>();
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  function resetAll() {
    setTitle("");
    setDestination("");
    setCurrency("JPY");
    setDateMode("direct");
    setError(null);
    setLoading(false);
    setStartDate("");
    setEndDate("");
    setCoverFile(null);
    setCoverPosition(50);
    setCandidates([]);
    setPendingRange(undefined);
    setCalendarMonth(new Date());
  }

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) resetAll();
  }

  function handleAddCandidate() {
    if (!pendingRange?.from) return;
    const start = format(pendingRange.from, "yyyy-MM-dd");
    const end = pendingRange.to ? format(pendingRange.to, "yyyy-MM-dd") : start;
    setCandidates((prev) => [...prev, { startDate: start, endDate: end }]);
    setPendingRange(undefined);
  }

  function handleRemoveCandidate(index: number) {
    setCandidates((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const title = formData.get("title") as string;
    const destination = (formData.get("destination") as string) || undefined;

    if (dateMode === "poll") {
      if (candidates.length === 0) {
        setError(tm("pollCandidateRequired"));
        return;
      }

      setLoading(true);
      const body: Record<string, unknown> = {
        title,
        pollOptions: candidates,
        currency,
      };
      if (destination) body.destination = destination;

      try {
        const result = await api<{ id: string }>("/api/trips", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (coverFile && result) {
          const url = await upload(result.id, coverFile);
          if (url && coverPosition !== 50) {
            await api(`/api/trips/${result.id}`, {
              method: "PATCH",
              body: JSON.stringify({ coverImagePosition: coverPosition }),
            });
          }
        }
        resetAll();
        onOpenChange(false);
        toast.success(tm("tripCreated"));
        onCreated();
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && err.message.includes("Guest")) {
          setError(tm("authGuestTripLimit"));
        } else {
          setError(
            getApiErrorMessage(err, tm("tripCreateFailed"), {
              byCode: {
                [ERROR_CODE.LIMIT_TRIPS]: (max) =>
                  tm("limitTrips", { max: max ?? MAX_TRIPS_PER_USER }),
              },
            }),
          );
        }
      } finally {
        setLoading(false);
      }
    } else {
      const sd = formData.get("startDate") as string;
      const ed = formData.get("endDate") as string;

      if (!sd || !ed) {
        setError(tm("tripDateRequired"));
        return;
      }

      setLoading(true);
      try {
        const result = await api<{ id: string }>("/api/trips", {
          method: "POST",
          body: JSON.stringify({
            title,
            ...(destination && { destination }),
            startDate: sd,
            endDate: ed,
            currency,
          }),
        });
        if (coverFile && result) {
          const url = await upload(result.id, coverFile);
          if (url && coverPosition !== 50) {
            await api(`/api/trips/${result.id}`, {
              method: "PATCH",
              body: JSON.stringify({ coverImagePosition: coverPosition }),
            });
          }
        }
        resetAll();
        onOpenChange(false);
        toast.success(tm("tripCreated"));
        onCreated();
      } catch (err) {
        if (err instanceof ApiError && err.status === 403 && err.message.includes("Guest")) {
          setError(tm("authGuestTripLimit"));
        } else {
          setError(
            getApiErrorMessage(err, tm("tripCreateFailed"), {
              byCode: {
                [ERROR_CODE.LIMIT_TRIPS]: (max) =>
                  tm("limitTrips", { max: max ?? MAX_TRIPS_PER_USER }),
              },
            }),
          );
        }
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{tt("createTitle")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{tt("createDescription")}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
          <div className="space-y-4 overflow-y-auto px-1">
            <div className="space-y-2">
              <Label htmlFor="create-title">
                {tt("tripTitle")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create-title"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tt("tripTitlePlaceholder")}
                maxLength={TRIP_TITLE_MAX_LENGTH}
                required
              />
              <p className="text-right text-xs text-muted-foreground">
                {title.length}/{TRIP_TITLE_MAX_LENGTH}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-destination">{tt("destination")}</Label>
              <Input
                id="create-destination"
                name="destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={tt("destinationPlaceholder")}
                maxLength={TRIP_DESTINATION_MAX_LENGTH}
              />
              <p className="text-right text-xs text-muted-foreground">
                {destination.length}/{TRIP_DESTINATION_MAX_LENGTH}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-currency">{tt("currency")}</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
                <SelectTrigger id="create-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(CURRENCIES).map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} - {locale === "ja" ? c.nameJa : c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tt("currencyHelp")}</p>
            </div>

            <CoverImagePicker
              imageUrl={null}
              previewFile={coverFile}
              position={coverPosition}
              onFileSelect={setCoverFile}
              onPositionChange={setCoverPosition}
              onRemove={() => {
                setCoverFile(null);
                setCoverPosition(50);
              }}
              disabled={loading || uploading}
            />
            {uploadError && (
              <p role="alert" className="text-sm text-destructive">
                {uploadError}
              </p>
            )}

            {/* Mode toggle */}
            <Tabs value={dateMode} onValueChange={(v) => setDateMode(v as DateMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="direct" className="flex-1">
                  {tt("decideDates")}
                </TabsTrigger>
                <TabsTrigger value="poll" className="flex-1">
                  {tt("adjustDates")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {dateMode === "direct" ? (
              <div className="space-y-2">
                <Label>
                  {tt("period")} <span className="text-destructive">*</span>
                </Label>
                <DateRangePicker
                  startDate={startDate}
                  endDate={endDate}
                  onChangeStart={setStartDate}
                  onChangeEnd={setEndDate}
                />
                <input type="hidden" name="startDate" value={startDate} />
                <input type="hidden" name="endDate" value={endDate} />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>
                    {tt("pollOptions")} <span className="text-destructive">*</span>
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddCandidate}
                    disabled={!pendingRange?.from}
                  >
                    <Plus className="h-4 w-4" />
                    {tt("addPollOption")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{tt("pollOptionHint")}</p>
                <div className="flex flex-col items-center">
                  <CalendarNav
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    showReset={!!pendingRange?.from}
                    onReset={() => setPendingRange(undefined)}
                  />
                  <Calendar
                    mode="range"
                    selected={pendingRange}
                    onSelect={setPendingRange}
                    month={calendarMonth}
                    onMonthChange={setCalendarMonth}
                    numberOfMonths={2}
                    locale={calendarLocale}
                    hideNavigation
                    startMonth={new Date(START_YEAR, 0)}
                    endMonth={new Date(END_YEAR, 11)}
                  />
                </div>

                {candidates.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {tt("addedOptions", { count: candidates.length })}
                    </p>
                    <div className="divide-y rounded-md border">
                      {candidates.map((opt, i) => (
                        <div
                          key={`${opt.startDate}-${opt.endDate}`}
                          className="flex items-center justify-between px-3 py-1.5"
                        >
                          <span className="text-sm">
                            {formatDateRangeShort(opt.startDate, opt.endDate, undefined, locale)}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveCandidate(i)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <ResponsiveDialogFooter className="shrink-0 border-t pt-4">
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                <X className="h-4 w-4" />
                {tc("cancel")}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={loading || uploading}>
              <Plus className="h-4 w-4" />
              {loading || uploading ? tt("creating") : tt("create")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
