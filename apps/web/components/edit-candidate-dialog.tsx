"use client";

import type {
  ScheduleColor,
  ScheduleResponse,
  TransportMethod,
  TripResponse,
} from "@sugara/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { toCandidateResponse, updateCandidate } from "@/lib/trip-cache";

type EditCandidateDialogProps = {
  tripId: string;
  schedule: ScheduleResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
  maxEndDayOffset?: number;
};

export function EditCandidateDialog({
  tripId,
  schedule,
  open,
  onOpenChange,
  onUpdate,
  maxEndDayOffset = 0,
}: EditCandidateDialogProps) {
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
        updateCandidate(prev, schedule.id, toCandidateResponse({ ...schedule, ...updateFields })),
      );
    }
    onOpenChange(false);
    toast.success(tm("candidateUpdated"));

    try {
      await api(`/api/trips/${tripId}/candidates/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      onUpdate();
    } catch (err) {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        toast.error(err.status === 409 ? tm("conflict") : tm("conflictDeleted"));
        onUpdate();
      } else {
        toast.error(tm("candidateUpdateFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{ts("editCandidate")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {ts("editCandidateDescription")}
          </ResponsiveDialogDescription>
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
            idPrefix="edit-candidate-"
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
              {loading ? ts("adding") : tc("update")}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
