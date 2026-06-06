"use client";

import type { ScheduleCategory, ScheduleColor, TransportMethod } from "@sugara/shared";
import {
  MAX_URLS_PER_SCHEDULE,
  SCHEDULE_ADDRESS_MAX_LENGTH,
  SCHEDULE_COLORS,
  SCHEDULE_MAX_COST,
  SCHEDULE_MEMO_MAX_LENGTH,
  SCHEDULE_NAME_MAX_LENGTH,
  SCHEDULE_PLACE_MAX_LENGTH,
  SCHEDULE_URL_MAX_LENGTH,
} from "@sugara/shared";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlacesAutocompleteInput } from "@/components/places-autocomplete-input";
import { TimeInput } from "@/components/time-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SCHEDULE_COLOR_CLASSES } from "@/lib/colors";
import { useOgpAutofill } from "@/lib/hooks/use-ogp-autofill";
import { cn } from "@/lib/utils";

type LocationSelectedParams = {
  address: string;
  latitude: number;
  longitude: number;
  placeId: string;
  name: string;
};

type ScheduleFormFieldsProps = {
  category: ScheduleCategory;
  onCategoryChange: (category: ScheduleCategory) => void;
  color: ScheduleColor;
  onColorChange: (color: ScheduleColor) => void;
  transportMethod: TransportMethod | "";
  onTransportMethodChange: (method: TransportMethod | "") => void;
  startTime: string | undefined;
  onStartTimeChange: (time: string | undefined) => void;
  endTime: string | undefined;
  onEndTimeChange: (time: string | undefined) => void;
  endDayOffset: number;
  onEndDayOffsetChange: (offset: number) => void;
  maxEndDayOffset: number;
  timeError: string | null;
  urls: string[];
  onUrlsChange: (urls: string[]) => void;
  defaultValues?: {
    name?: string;
    address?: string;
    departurePlace?: string;
    arrivalPlace?: string;
    memo?: string;
    cost?: number | null;
  };
  idPrefix?: string;
  mapsEnabled?: boolean;
  onLocationSelected?: (params: LocationSelectedParams) => void;
};

export function ScheduleFormFields({
  category,
  onCategoryChange,
  color,
  onColorChange,
  transportMethod,
  onTransportMethodChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  endDayOffset,
  onEndDayOffsetChange,
  maxEndDayOffset,
  timeError,
  urls,
  onUrlsChange,
  defaultValues,
  idPrefix = "",
  mapsEnabled = false,
  onLocationSelected,
}: ScheduleFormFieldsProps) {
  const tsf = useTranslations("scheduleForm");
  const tlCat = useTranslations("labels.category");
  const tlTransport = useTranslations("labels.transportMethod");
  const tlColor = useTranslations("labels.scheduleColor");

  const categoryOptions = (
    ["sightseeing", "restaurant", "hotel", "transport", "activity", "other"] as const
  ).map((v) => ({ value: v, label: tlCat(v) }));
  const transportMethodOptions = (
    ["train", "shinkansen", "bus", "taxi", "walk", "car", "bicycle", "airplane"] as const
  ).map((v) => ({ value: v, label: tlTransport(v) }));
  // Controlled state for text fields (Dialog unmounts on close, so these re-init correctly)
  const [name, setName] = useState(defaultValues?.name ?? "");
  // Ref to read current name inside handlePlaceSelect without adding name to deps
  // (which would cause PlacesAutocompleteInput to re-create its Autocomplete instance)
  const nameRef = useRef(name);
  nameRef.current = name;

  const handleOgpTitle = useCallback((title: string) => {
    if (!nameRef.current) {
      setName(title.slice(0, SCHEDULE_NAME_MAX_LENGTH));
    }
  }, []);

  const firstUrl = urls.find((u) => u.trim() !== "") ?? "";
  useOgpAutofill({ url: firstUrl, name, onTitleFetched: handleOgpTitle });

  const [address, setAddress] = useState(defaultValues?.address ?? "");
  const [departurePlace, setDeparturePlace] = useState(defaultValues?.departurePlace ?? "");
  const [arrivalPlace, setArrivalPlace] = useState(defaultValues?.arrivalPlace ?? "");
  const [cost, setCost] = useState(defaultValues?.cost != null ? String(defaultValues.cost) : "");
  const [memo, setMemo] = useState(defaultValues?.memo ?? "");

  // Always show at least one URL input
  const displayUrls = urls.length > 0 ? urls : [""];

  // Stable keys for the dynamic URL list to avoid index-based keys.
  // useRef for key counter avoids stale closures; useState for the key array triggers re-render.
  const nextKeyRef = useRef(displayUrls.length);
  const [urlKeys, setUrlKeys] = useState<number[]>(() => displayUrls.map((_, i) => i));

  // Sync keys when displayUrls length changes from parent (e.g. dialog reset)
  useEffect(() => {
    nextKeyRef.current = displayUrls.length;
    setUrlKeys(Array.from({ length: displayUrls.length }, (_, i) => i));
  }, [displayUrls.length]);

  const addUrlKey = useCallback(() => {
    const key = nextKeyRef.current++;
    setUrlKeys((prev) => [...prev, key]);
  }, []);

  const removeUrlKey = useCallback((index: number) => {
    setUrlKeys((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePlaceSelect = useCallback(
    ({
      formattedAddress,
      lat,
      lng,
      placeId,
      displayName,
    }: {
      formattedAddress: string;
      lat: number;
      lng: number;
      placeId: string;
      displayName: string;
    }) => {
      setAddress(formattedAddress);
      // Auto-fill name only when empty (read via ref to avoid adding name to deps)
      if (nameRef.current === "") setName(displayName);
      onLocationSelected?.({
        address: formattedAddress,
        latitude: lat,
        longitude: lng,
        placeId,
        name: displayName,
      });
    },
    [onLocationSelected],
  );

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}name`}>
          {tsf("name")} <span className="text-destructive">*</span>
        </Label>
        <Input
          id={`${idPrefix}name`}
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tsf("namePlaceholder")}
          required
          maxLength={SCHEDULE_NAME_MAX_LENGTH}
        />
        <p className="text-right text-xs text-muted-foreground">
          {name.length}/{SCHEDULE_NAME_MAX_LENGTH}
        </p>
      </div>
      <div className="space-y-2">
        <Label>{tsf("category")}</Label>
        <Select
          value={category}
          onValueChange={(v) => {
            onCategoryChange(v as ScheduleCategory);
            onTransportMethodChange("");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{tsf("color")}</Label>
        <div className="flex gap-2">
          {SCHEDULE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColorChange(c)}
              className={cn(
                "h-6 w-6 rounded-full",
                SCHEDULE_COLOR_CLASSES[c].bg,
                color === c && `ring-2 ring-offset-1 ${SCHEDULE_COLOR_CLASSES[c].ring}`,
              )}
              aria-label={tlColor(c)}
            />
          ))}
        </div>
      </div>
      {category !== "transport" &&
        (mapsEnabled ? (
          <div className="space-y-2" data-testid="places-autocomplete">
            <Label htmlFor={`${idPrefix}address`}>{tsf("address")}</Label>
            <PlacesAutocompleteInput
              id={`${idPrefix}address`}
              defaultValue={defaultValues?.address ?? ""}
              onPlaceSelect={handlePlaceSelect}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}address`}>{tsf("address")}</Label>
            <Input
              id={`${idPrefix}address`}
              name="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={tsf("addressPlaceholder")}
              maxLength={SCHEDULE_ADDRESS_MAX_LENGTH}
            />
            <p className="text-right text-xs text-muted-foreground">
              {address.length}/{SCHEDULE_ADDRESS_MAX_LENGTH}
            </p>
          </div>
        ))}
      {category === "transport" && (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}departurePlace`}>{tsf("departurePlace")}</Label>
            <Input
              id={`${idPrefix}departurePlace`}
              name="departurePlace"
              value={departurePlace}
              onChange={(e) => setDeparturePlace(e.target.value)}
              placeholder={tsf("departurePlaceholder")}
              maxLength={SCHEDULE_PLACE_MAX_LENGTH}
            />
            <p className="text-right text-xs text-muted-foreground">
              {departurePlace.length}/{SCHEDULE_PLACE_MAX_LENGTH}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}arrivalPlace`}>{tsf("arrivalPlace")}</Label>
            <Input
              id={`${idPrefix}arrivalPlace`}
              name="arrivalPlace"
              value={arrivalPlace}
              onChange={(e) => setArrivalPlace(e.target.value)}
              placeholder={tsf("arrivalPlaceholder")}
              maxLength={SCHEDULE_PLACE_MAX_LENGTH}
            />
            <p className="text-right text-xs text-muted-foreground">
              {arrivalPlace.length}/{SCHEDULE_PLACE_MAX_LENGTH}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{tsf("transportMethod")}</Label>
            <Select
              value={transportMethod}
              onValueChange={(v) => onTransportMethodChange(v as TransportMethod)}
            >
              <SelectTrigger>
                <SelectValue placeholder={tsf("transportPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {transportMethodOptions.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}cost`}>{tsf("cost")}</Label>
            <Input
              id={`${idPrefix}cost`}
              name="cost"
              type="number"
              inputMode="numeric"
              min={0}
              max={SCHEDULE_MAX_COST}
              step={1}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder={tsf("costPlaceholder")}
            />
          </div>
        </>
      )}
      <div className="space-y-2">
        <Label>{tsf("url")}</Label>
        {displayUrls.map((url, index) => (
          <div key={urlKeys[index]} className="flex items-center gap-1">
            <Input
              type="url"
              value={url}
              onChange={(e) => {
                const next = [...displayUrls];
                next[index] = e.target.value;
                onUrlsChange(next);
              }}
              placeholder="https://..."
              maxLength={SCHEDULE_URL_MAX_LENGTH}
            />
            {index > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  removeUrlKey(index);
                  onUrlsChange(displayUrls.filter((_, i) => i !== index));
                }}
                aria-label={tsf("removeUrl")}
              >
                <Minus className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {displayUrls.length < MAX_URLS_PER_SCHEDULE && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              addUrlKey();
              onUrlsChange([...displayUrls, ""]);
            }}
          >
            <Plus className="inline h-3 w-3" /> {tsf("addUrl")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>
            {category === "transport"
              ? tsf("departureTime")
              : category === "hotel"
                ? tsf("checkIn")
                : tsf("startTime")}
          </Label>
          <TimeInput value={startTime} onChange={onStartTimeChange} />
        </div>
        <div className="space-y-2">
          <Label>
            {category === "transport"
              ? tsf("arrivalTime")
              : category === "hotel"
                ? tsf("checkOut")
                : tsf("endTime")}
          </Label>
          <TimeInput value={endTime} onChange={onEndTimeChange} />
        </div>
      </div>
      {maxEndDayOffset > 0 && (
        <div className="space-y-2">
          <Label>
            {category === "transport"
              ? tsf("arrivalTime")
              : category === "hotel"
                ? tsf("checkOut")
                : tsf("endTime")}
            {tsf("endDay")}
          </Label>
          <Select
            value={String(endDayOffset)}
            onValueChange={(v) => onEndDayOffsetChange(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: maxEndDayOffset + 1 }, (_, offset) => {
                const val = String(offset);
                return (
                  <SelectItem key={val} value={val}>
                    {offset === 0
                      ? tsf("sameDay")
                      : offset === 1
                        ? tsf("nextDay")
                        : tsf("daysAfter", { count: offset })}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
      {timeError && <p className="text-sm text-destructive">{timeError}</p>}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}memo`}>{tsf("memo")}</Label>
        <Textarea
          id={`${idPrefix}memo`}
          name="memo"
          rows={3}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={SCHEDULE_MEMO_MAX_LENGTH}
        />
        <p className="text-right text-xs text-muted-foreground">
          {memo.length}/{SCHEDULE_MEMO_MAX_LENGTH}
        </p>
      </div>
    </>
  );
}
