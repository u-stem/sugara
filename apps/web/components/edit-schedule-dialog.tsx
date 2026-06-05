"use client";

import type {
  ScheduleColor,
  ScheduleResponse,
  TimeDelta,
  TransportMethod,
  TripResponse,
} from "@sugara/shared";
import { computeTimeDelta } from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
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
} from "@/components/ui/responsive-dialog";
import { ApiError, api } from "@/lib/api";
import { validateTimeRange } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { buildSchedulePayload } from "@/lib/schedule-form-utils";
import { toScheduleResponse, updateScheduleInPattern } from "@/lib/trip-cache";

type EditScheduleDialogProps = {
  tripId: string;
  dayId: string;
  patternId: string;
  schedule: ScheduleResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
  maxEndDayOffset?: number;
  onShiftProposal?: (timeDelta: TimeDelta) => void;
  mapsEnabled?: boolean;
};

export function EditScheduleDialog({
  tripId,
  dayId,
  patternId,
  schedule,
  open,
  onOpenChange,
  onUpdate,
  maxEndDayOffset = 0,
  onShiftProposal,
  mapsEnabled = false,
}: EditScheduleDialogProps) {
  const tm = useTranslations("messages");
  const ts = useTranslations("schedule");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.trips.detail(tripId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(schedule.category);
  const [transportMethod, setTransportMethod] = useState<TransportMethod | "">(
    (schedule.transportMethod as TransportMethod) || "",
  );
  const [color, setColor] = useState<ScheduleColor>(schedule.color);
  const [startTime, setStartTime] = useState<string | undefined>(schedule.startTime ?? undefined);
  const [endTime, setEndTime] = useState<string | undefined>(schedule.endTime ?? undefined);
  const [endDayOffset, setEndDayOffset] = useState(schedule.endDayOffset ?? 0);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [urls, setUrls] = useState<string[]>(schedule.urls ?? []);
  const [latitude, setLatitude] = useState<number | null>(schedule.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(schedule.longitude ?? null);
  const [placeId, setPlaceId] = useState<string | null>(schedule.placeId ?? null);

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

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) {
      setError(null);
      setTimeError(null);
      setCategory(schedule.category);
      setTransportMethod((schedule.transportMethod as TransportMethod) || "");
      setColor(schedule.color);
      setStartTime(schedule.startTime ?? undefined);
      setEndTime(schedule.endTime ?? undefined);
      setEndDayOffset(schedule.endDayOffset ?? 0);
      setUrls(schedule.urls ?? []);
      setLatitude(schedule.latitude ?? null);
      setLongitude(schedule.longitude ?? null);
      setPlaceId(schedule.placeId ?? null);
    }
  }

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
    const data = {
      ...buildSchedulePayload(formData, {
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
      }),
      endDayOffset: endDayOffset > 0 ? endDayOffset : null,
      expectedUpdatedAt: schedule.updatedAt,
    };

    const { expectedUpdatedAt: _, ...updateFields } = data;

    queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<TripResponse>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        updateScheduleInPattern(
          prev,
          dayId,
          patternId,
          schedule.id,
          toScheduleResponse({ ...schedule, ...updateFields }),
        ),
      );
    }
    onOpenChange(false);
    toast.success(tm("scheduleUpdated"));

    try {
      await api(
        `/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules/${schedule.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(data),
        },
      );
      onUpdate();

      const timeDelta = computeTimeDelta(schedule, {
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        endDayOffset: endDayOffset > 0 ? endDayOffset : null,
      });
      if (timeDelta && onShiftProposal) {
        onShiftProposal(timeDelta);
      }
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        toast.error(err.status === 409 ? tm("conflict") : tm("conflictDeleted"));
        onUpdate();
      } else {
        toast.error(tm("scheduleUpdateFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{ts("editSchedule")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{ts("editScheduleDescription")}</ResponsiveDialogDescription>
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
            defaultValues={{
              name: schedule.name,
              address: schedule.address ?? "",
              departurePlace: schedule.departurePlace ?? "",
              arrivalPlace: schedule.arrivalPlace ?? "",
              memo: schedule.memo ?? "",
              cost: schedule.cost ?? null,
            }}
            idPrefix="edit-"
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
              <Check className="h-4 w-4" />
              {loading ? ts("adding") : ts("updateSchedule")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
