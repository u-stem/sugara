import { getWeatherForCode, type WeatherIcon as WeatherIconKey } from "@sugara/shared";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

// Map the shared abstract icon key to a concrete lucide component + tint. Kept
// here (web side) so the shared package stays UI-framework agnostic.
const ICONS: Record<WeatherIconKey, { Icon: typeof Sun; className: string }> = {
  sun: { Icon: Sun, className: "text-amber-500" },
  "cloud-sun": { Icon: CloudSun, className: "text-amber-400" },
  cloud: { Icon: Cloud, className: "text-slate-400" },
  "cloud-rain": { Icon: CloudRain, className: "text-blue-500" },
  "cloud-snow": { Icon: CloudSnow, className: "text-sky-300" },
  "cloud-lightning": { Icon: CloudLightning, className: "text-violet-500" },
  "cloud-fog": { Icon: CloudFog, className: "text-slate-400" },
};

type WeatherIconProps = {
  weatherCode: string;
  className?: string;
  // Accessible label; defaults to the JMA label for the code.
  label?: string;
};

export function WeatherIcon({ weatherCode, className, label }: WeatherIconProps) {
  const { label: codeLabel, icon } = getWeatherForCode(weatherCode);
  const { Icon, className: tint } = ICONS[icon];
  return (
    <Icon className={cn("h-6 w-6", tint, className)} aria-label={label ?? codeLabel} role="img" />
  );
}
