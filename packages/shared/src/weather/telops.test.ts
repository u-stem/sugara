import { describe, expect, it } from "vitest";
import { getWeatherForCode, WEATHER_CODE_LABELS } from "./telops";

describe("getWeatherForCode", () => {
  it("returns the transcribed label (ja + en) for a known code", () => {
    expect(getWeatherForCode("100")).toEqual({ label: "晴れ", labelEn: "Clear", icon: "sun" });
    expect(getWeatherForCode("200")).toEqual({ label: "くもり", labelEn: "Cloudy", icon: "cloud" });
    expect(getWeatherForCode("300")).toEqual({ label: "雨", labelEn: "Rain", icon: "cloud-rain" });
    expect(getWeatherForCode("400")).toEqual({ label: "雪", labelEn: "Snow", icon: "cloud-snow" });
  });

  it("provides a headline English label per icon", () => {
    expect(getWeatherForCode("101").labelEn).toBe("Partly cloudy"); // 晴れ時々くもり
    expect(getWeatherForCode("108").labelEn).toBe("Thunderstorms"); // 雷雨
    expect(getWeatherForCode("209").labelEn).toBe("Fog"); // 霧
  });

  it("derives cloud-sun for sunny-then-cloudy and cloudy-then-sunny", () => {
    expect(getWeatherForCode("101").icon).toBe("cloud-sun"); // 晴れ時々くもり
    expect(getWeatherForCode("201").icon).toBe("cloud-sun"); // くもり時々晴れ
  });

  it("prioritizes precipitation tokens over base sky condition", () => {
    expect(getWeatherForCode("102").icon).toBe("cloud-rain"); // 晴れ一時雨
    expect(getWeatherForCode("104").icon).toBe("cloud-snow"); // 晴れ一時雪
    expect(getWeatherForCode("108").icon).toBe("cloud-lightning"); // 晴れ一時雨か雷雨
    expect(getWeatherForCode("209").icon).toBe("cloud-fog"); // 霧
    expect(getWeatherForCode("329").icon).toBe("cloud-snow"); // 雨一時みぞれ
  });

  it("falls back to the leading-digit category for unknown codes", () => {
    expect(getWeatherForCode("199")).toMatchObject({ label: "晴れ", icon: "sun" });
    expect(getWeatherForCode("299")).toMatchObject({ label: "くもり", icon: "cloud" });
    expect(getWeatherForCode("399")).toMatchObject({ label: "雨", icon: "cloud-rain" });
    expect(getWeatherForCode("499")).toMatchObject({ label: "雪", icon: "cloud-snow" });
  });

  it("returns a defined icon for every code in the label table", () => {
    const icons = new Set([
      "sun",
      "cloud-sun",
      "cloud",
      "cloud-rain",
      "cloud-snow",
      "cloud-lightning",
      "cloud-fog",
    ]);
    for (const code of Object.keys(WEATHER_CODE_LABELS)) {
      expect(icons.has(getWeatherForCode(code).icon)).toBe(true);
    }
  });
});
