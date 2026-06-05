"use client";

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { ScheduleFormFields } from "./schedule-form-fields";

vi.mock("@vis.gl/react-google-maps", () => ({
  useMapsLibrary: vi.fn(() => null),
}));

// PlacesAutocompleteInput の test double: クリックで onPlaceSelect を呼ぶ
vi.mock("@/components/places-autocomplete-input", () => ({
  PlacesAutocompleteInput: ({
    id,
    onPlaceSelect,
  }: {
    id?: string;
    onPlaceSelect: (result: {
      formattedAddress: string;
      lat: number;
      lng: number;
      placeId: string;
      displayName: string;
    }) => void;
  }) => (
    <button
      type="button"
      id={id}
      data-testid="places-autocomplete-input"
      onClick={() =>
        onPlaceSelect({
          formattedAddress: "東京タワー",
          lat: 35.6586,
          lng: 139.7454,
          placeId: "ChIJT2x8Q2uLGGARcW4WMjBFIw8",
          displayName: "東京タワー",
        })
      }
    >
      場所を検索...
    </button>
  ),
}));

describe("ScheduleFormFields - address フィールド", () => {
  const baseProps = {
    category: "sightseeing" as const,
    onCategoryChange: vi.fn(),
    color: "blue" as const,
    onColorChange: vi.fn(),
    transportMethod: "" as const,
    onTransportMethodChange: vi.fn(),
    startTime: undefined,
    onStartTimeChange: vi.fn(),
    endTime: undefined,
    onEndTimeChange: vi.fn(),
    endDayOffset: 0,
    onEndDayOffsetChange: vi.fn(),
    maxEndDayOffset: 0,
    timeError: null,
    urls: [],
    onUrlsChange: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("mapsEnabled=false のとき通常の Input が表示される", () => {
    renderWithIntl(<ScheduleFormFields {...baseProps} mapsEnabled={false} />);
    const input = screen.getByRole("textbox", { name: /住所/ });
    expect(input.tagName).toBe("INPUT");
  });

  it("mapsEnabled=true のとき Places Autocomplete コンテナが表示される", () => {
    renderWithIntl(<ScheduleFormFields {...baseProps} mapsEnabled={true} />);
    expect(screen.getByTestId("places-autocomplete")).toBeDefined();
  });

  it("onLocationSelected が呼ばれると親に lat/lng が伝わる", () => {
    const onLocationSelected = vi.fn();
    renderWithIntl(
      <ScheduleFormFields
        {...baseProps}
        mapsEnabled={true}
        onLocationSelected={onLocationSelected}
      />,
    );
    fireEvent.click(screen.getByTestId("places-autocomplete-input"));
    expect(onLocationSelected).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 35.6586, longitude: 139.7454 }),
    );
  });
});

describe("ScheduleFormFields - transport の交通費フィールド", () => {
  const transportProps = {
    category: "transport" as const,
    onCategoryChange: vi.fn(),
    color: "blue" as const,
    onColorChange: vi.fn(),
    transportMethod: "" as const,
    onTransportMethodChange: vi.fn(),
    startTime: undefined,
    onStartTimeChange: vi.fn(),
    endTime: undefined,
    onEndTimeChange: vi.fn(),
    endDayOffset: 0,
    onEndDayOffsetChange: vi.fn(),
    maxEndDayOffset: 0,
    timeError: null,
    urls: [],
    onUrlsChange: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("transport カテゴリで交通費入力欄が表示される", () => {
    renderWithIntl(<ScheduleFormFields {...transportProps} />);
    const input = screen.getByRole("spinbutton", { name: /交通費/ });
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("name")).toBe("cost");
  });

  it("transport 以外のカテゴリでは交通費入力欄が表示されない", () => {
    renderWithIntl(<ScheduleFormFields {...transportProps} category="sightseeing" />);
    expect(screen.queryByRole("spinbutton", { name: /交通費/ })).toBeNull();
  });

  it("defaultValues.cost が初期値として入る", () => {
    renderWithIntl(<ScheduleFormFields {...transportProps} defaultValues={{ cost: 580 }} />);
    const input = screen.getByRole("spinbutton", { name: /交通費/ });
    expect((input as HTMLInputElement).value).toBe("580");
  });
});
