import {
  SCHEDULE_MAX_COST,
  type ScheduleCategory,
  type ScheduleColor,
  type TransportMethod,
} from "@sugara/shared";

type ScheduleFormState = {
  category: ScheduleCategory;
  color: ScheduleColor;
  startTime: string | undefined;
  endTime: string | undefined;
  transportMethod: TransportMethod | "";
  endDayOffset: number;
  urls: string[];
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
};

// Use `emptyToNull` for clearable text/time fields so the API receives null to clear the value,
// rather than omitting the field (which would leave the old value intact on partial updates).
// Use `|| undefined` only for fields that should be omitted entirely when unset (e.g. transportMethod).
function emptyToNull(value: string | null): string | null {
  return value && value.trim() !== "" ? value : null;
}

// Parse the optional transit-fare input. Empty -> null (clears the value on update);
// non-numeric or negative -> null rather than sending an invalid value the API would reject.
function parseCost(value: string | null): number | null {
  if (!value || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  // Defensively clamp to the same upper bound the API enforces, so an oversized
  // input fails fast on the client rather than triggering a server rejection.
  if (n > SCHEDULE_MAX_COST) return null;
  return n;
}

export function buildSchedulePayload(formData: FormData, state: ScheduleFormState) {
  return {
    name: formData.get("name") as string,
    category: state.category,
    color: state.color,
    address:
      state.category !== "transport" ? emptyToNull(formData.get("address") as string) : undefined,
    urls: state.urls.filter((u) => u.trim() !== ""),
    startTime: state.startTime ?? null,
    endTime: state.endTime ?? null,
    memo: emptyToNull(formData.get("memo") as string),
    ...(state.category === "transport"
      ? {
          departurePlace: emptyToNull(formData.get("departurePlace") as string),
          arrivalPlace: emptyToNull(formData.get("arrivalPlace") as string),
          transportMethod: state.transportMethod || undefined,
          cost: parseCost(formData.get("cost") as string),
        }
      : {}),
    ...(state.endDayOffset > 0 ? { endDayOffset: state.endDayOffset } : {}),
    ...(state.latitude != null ? { latitude: state.latitude } : {}),
    ...(state.longitude != null ? { longitude: state.longitude } : {}),
    ...(state.placeId != null ? { placeId: state.placeId } : {}),
  };
}
