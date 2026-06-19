"use client";

import { useParams } from "next/navigation";
import { WeatherDetail } from "@/components/weather-detail";

export default function WeatherDetailPage() {
  const { officeCode } = useParams<{ officeCode: string }>();

  return (
    <div className="mt-4 mx-auto max-w-xl">
      <WeatherDetail officeCode={officeCode} basePath="/tools/weather" />
    </div>
  );
}
