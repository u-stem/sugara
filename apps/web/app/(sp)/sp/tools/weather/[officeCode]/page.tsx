"use client";

import { useParams } from "next/navigation";
import { WeatherDetail } from "@/components/weather-detail";

export default function SpWeatherDetailPage() {
  const { officeCode } = useParams<{ officeCode: string }>();

  return (
    <div className="mt-4 mx-auto max-w-xl">
      <WeatherDetail officeCode={officeCode} basePath="/sp/tools/weather" />
    </div>
  );
}
