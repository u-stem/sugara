import { describe, expect, it } from "vitest";
import { getWeatherForCode, WEATHER_CODE_LABELS } from "./telops";

describe("getWeatherForCode", () => {
  it.each([
    { code: "100", expected: { label: "晴れ", labelEn: "Clear", icon: "sun" } },
    { code: "200", expected: { label: "くもり", labelEn: "Cloudy", icon: "cloud" } },
    { code: "300", expected: { label: "雨", labelEn: "Rain", icon: "cloud-rain" } },
    { code: "400", expected: { label: "雪", labelEn: "Snow", icon: "cloud-snow" } },
  ])("returns the transcribed label (ja + en) for $code", ({ code, expected }) => {
    expect(getWeatherForCode(code)).toEqual(expected);
  });

  it.each([
    { code: "101", labelEn: "Partly cloudy" }, // 晴れ時々くもり
    { code: "108", labelEn: "Thunderstorms" }, // 雷雨
    { code: "209", labelEn: "Fog" }, // 霧
  ])("provides a headline English label for $code", ({ code, labelEn }) => {
    expect(getWeatherForCode(code).labelEn).toBe(labelEn);
  });

  it.each([
    { code: "101" }, // 晴れ時々くもり
    { code: "201" }, // くもり時々晴れ
  ])("derives cloud-sun for mixed sun/cloud code $code", ({ code }) => {
    expect(getWeatherForCode(code).icon).toBe("cloud-sun");
  });

  it.each([
    { code: "102", icon: "cloud-rain" }, // 晴れ一時雨
    { code: "104", icon: "cloud-snow" }, // 晴れ一時雪
    { code: "108", icon: "cloud-lightning" }, // 晴れ一時雨か雷雨
    { code: "209", icon: "cloud-fog" }, // 霧
    { code: "329", icon: "cloud-snow" }, // 雨一時みぞれ
  ])("prioritizes precipitation over base sky for $code", ({ code, icon }) => {
    expect(getWeatherForCode(code).icon).toBe(icon);
  });

  it.each([
    { code: "199", expected: { label: "晴れ", icon: "sun" } },
    { code: "299", expected: { label: "くもり", icon: "cloud" } },
    { code: "399", expected: { label: "雨", icon: "cloud-rain" } },
    { code: "499", expected: { label: "雪", icon: "cloud-snow" } },
  ])("falls back to the leading-digit category for unknown code $code", ({ code, expected }) => {
    expect(getWeatherForCode(code)).toMatchObject(expected);
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
