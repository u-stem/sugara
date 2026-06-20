import type { WeatherDetailResponse } from "@sugara/shared";
import { useIsRestoring, useQuery } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { WeatherDetail } from "./weather-detail";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useIsRestoring: vi.fn(() => false),
}));

// Hokkaido (Sapporo) — present in WEATHER_MAP_PATHS, so the map renders a layout.
const OFFICE_CODE = "011000";

function baseResponse(days: WeatherDetailResponse["days"]): WeatherDetailResponse {
  return {
    officeCode: OFFICE_CODE,
    name: "札幌",
    centerName: "北海道地方",
    reportDatetime: "2026-06-20T05:00:00+09:00",
    days,
  };
}

function mockQuery(state: {
  data?: WeatherDetailResponse;
  isLoading: boolean;
  isFetching: boolean;
}) {
  vi.mocked(useQuery).mockReturnValue({
    data: state.data,
    isLoading: state.isLoading,
    isError: false,
    isFetching: state.isFetching,
  } as ReturnType<typeof useQuery>);
}

function render() {
  return renderWithIntl(<WeatherDetail officeCode={OFFICE_CODE} basePath="/tools/weather" />);
}

afterEach(() => {
  cleanup();
  vi.mocked(useIsRestoring).mockReturnValue(false);
});

const sampleDay: WeatherDetailResponse["days"][number] = {
  date: "2026-06-20",
  weatherCode: "100",
  tempMax: 25,
  tempMin: 18,
  pop: 10,
  reliability: null,
};

describe("WeatherDetail", () => {
  it("does not paint the static map alone while a refetch fills empty days", () => {
    // The regression: data exists with no days yet and a background refetch is in
    // flight. The map needs no network, so it must not appear before the table.
    mockQuery({ data: baseResponse([]), isLoading: false, isFetching: true });
    render();

    expect(screen.queryByRole("img", { name: /日本地図/ })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the table and the map together once forecast days arrive", () => {
    mockQuery({ data: baseResponse([sampleDay]), isLoading: false, isFetching: false });
    render();

    expect(screen.queryByRole("table")).not.toBeNull();
    expect(screen.queryByRole("img", { name: /日本地図/ })).not.toBeNull();
  });

  it("shows the empty notice when the fetch settles on no forecast", () => {
    mockQuery({ data: baseResponse([]), isLoading: false, isFetching: false });
    render();

    expect(
      screen.queryByText(
        "この地域の天気はまだ取得されていません。しばらくしてから再度お試しください。",
      ),
    ).not.toBeNull();
  });
});
