import { cn } from "@/lib/utils";
import { formatTemp } from "@/lib/weather-format";

// Render high/low temperatures, always keeping the "high / low" layout so columns
// line up across days. When the low is unavailable (e.g. today, whose morning low
// has already passed at the JMA issue time) the low slot shows a dash rather than
// mirroring the high as a misleading "30°/30°".
export function WeatherTemps({
  tempMax,
  tempMin,
  className,
}: {
  tempMax: number | null;
  tempMin: number | null;
  className?: string;
}) {
  // Each value sits in a fixed-width, right-aligned slot so single- and
  // double-digit temperatures (9° vs 18°) line up and the "/" stays put.
  return (
    <span className={cn("tabular-nums", className)}>
      <span className="inline-block w-8 text-right text-rose-500">{formatTemp(tempMax)}</span>
      <span className="px-0.5 text-muted-foreground">/</span>
      <span className="inline-block w-8 text-right text-blue-500">{formatTemp(tempMin)}</span>
    </span>
  );
}
