"use client";

import type {
  ScheduleCategory,
  ScheduleColor,
  TransportMethod,
  TripResponse,
} from "@sugara/shared";
import { DEFAULT_SCHEDULE_CATEGORY } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ScheduleFormFields } from "@/components/schedule-form-fields";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { api, getApiErrorMessage } from "@/lib/api";
import { validateTimeRange } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { buildSchedulePayload } from "@/lib/schedule-form-utils";
import { addScheduleToPattern, toScheduleResponse } from "@/lib/trip-cache";

type AddScheduleDialogProps = {
  tripId: string;
  dayId: string;
  patternId: string;
  onAdd: () => void;
  disabled?: boolean;
  maxEndDayOffset?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  mapsEnabled?: boolean;
};

export function AddScheduleDialog({
  tripId,
  dayId,
  patternId,
  onAdd,
  disabled,
  maxEndDayOffset = 0,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger,
  mapsEnabled = false,
}: AddScheduleDialogProps) {
  const tm = useTranslations("messages");
  const ts = useTranslations("schedule");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.trips.detail(tripId);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ScheduleCategory>(DEFAULT_SCHEDULE_CATEGORY);
  const [transportMethod, setTransportMethod] = useState<TransportMethod | "">("");
  const [color, setColor] = useState<ScheduleColor>("blue");
  const [startTime, setStartTime] = useState<string | undefined>();
  const [endTime, setEndTime] = useState<string | undefined>();
  const [endDayOffset, setEndDayOffset] = useState(0);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);

  function resetForm() {
    setError(null);
    setCategory(DEFAULT_SCHEDULE_CATEGORY);
    setTransportMethod("");
    setColor("blue");
    setStartTime(undefined);
    setEndTime(undefined);
    setEndDayOffset(0);
    setTimeError(null);
    setUrls([]);
    setLatitude(null);
    setLongitude(null);
    setPlaceId(null);
  }

  const handleLocationSelected = useCallback(
    ({
      latitude: lat,
      longitude: lng,
      placeId: pid,
    }: {
      latitude: number;
      longitude: number;
      placeId: string;
      address: string;
      name: string;
    }) => {
      setLatitude(lat);
      setLongitude(lng);
      setPlaceId(pid);
    },
    [],
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTimeError(null);

    const timeValidationKey = validateTimeRange(startTime, endTime, {
      allowOvernight: endDayOffset > 0,
      category,
    });
    if (timeValidationKey) {
      setTimeError((tm as (k: string) => string)(timeValidationKey));
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = buildSchedulePayload(formData, {
      category,
      color,
      startTime,
      endTime,
      transportMethod,
      endDayOffset,
      urls,
      latitude,
      longitude,
      placeId,
    });

    try {
      const result = await api<Record<string, unknown>>(
        `/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      );
      // Stop any in-flight trip GET: it could resolve after setQueryData with
      // a stale snapshot and overwrite the just-added schedule (#123).
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const prev = queryClient.getQueryData<TripResponse>(cacheKey);
      if (prev) {
        queryClient.setQueryData(
          cacheKey,
          addScheduleToPattern(prev, dayId, patternId, toScheduleResponse(result)),
        );
      }
      resetForm();
      setOpen(false);
      toast.success(tm("scheduleAdded"));
      onAdd();
    } catch (err) {
      setError(getApiErrorMessage(err, tm("scheduleAddFailed")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) resetForm();
      }}
    >
      {!hideTrigger && (
        <ResponsiveDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled}>
            <Plus className="h-4 w-4" />
            {ts("addSchedule")}
            <span className="hidden text-xs text-muted-foreground lg:inline">(A)</span>
          </Button>
        </ResponsiveDialogTrigger>
      )}
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{ts("addSchedule")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{ts("addScheduleDescription")}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <ScheduleFormFields
            category={category}
            onCategoryChange={setCategory}
            color={color}
            onColorChange={setColor}
            transportMethod={transportMethod}
            onTransportMethodChange={setTransportMethod}
            startTime={startTime}
            onStartTimeChange={setStartTime}
            endTime={endTime}
            onEndTimeChange={setEndTime}
            endDayOffset={endDayOffset}
            onEndDayOffsetChange={setEndDayOffset}
            maxEndDayOffset={maxEndDayOffset}
            timeError={timeError}
            urls={urls}
            onUrlsChange={setUrls}
            mapsEnabled={mapsEnabled}
            onLocationSelected={handleLocationSelected}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                <X className="h-4 w-4" />
                {tc("cancel")}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={loading}>
              <Plus className="h-4 w-4" />
              {loading ? ts("adding") : ts("addSchedule")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
