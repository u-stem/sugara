// Japan Meteorological Agency (JMA) weather code -> label / icon mapping.
//
// JMA publishes weather codes (3-digit telop codes) only inside its frontend
// JS bundle, not as a stable JSON endpoint, so the label table below is
// transcribed from the public telop table. The icon for each code is derived
// from the label so that new/rare codes still resolve to a sane icon instead of
// throwing. Travelers care most about precipitation, so precipitation tokens
// (雷/雪/雨/霧) win over the base sky condition when choosing an icon.

// Abstract icon keys resolved to concrete lucide-react components on the web side.
// Kept abstract here so the shared package stays UI-framework agnostic.
export type WeatherIcon =
  | "sun"
  | "cloud-sun"
  | "cloud"
  | "cloud-rain"
  | "cloud-snow"
  | "cloud-lightning"
  | "cloud-fog";

// Transcribed JMA telop labels. Not exhaustive of every historical code, but
// covers the codes that actually appear in the forecast feed; anything missing
// falls back to a leading-digit label (see getWeatherForCode).
export const WEATHER_CODE_LABELS: Record<string, string> = {
  "100": "晴れ",
  "101": "晴れ時々くもり",
  "102": "晴れ一時雨",
  "103": "晴れ時々雨",
  "104": "晴れ一時雪",
  "105": "晴れ時々雪",
  "106": "晴れ一時雨か雪",
  "107": "晴れ時々雨か雪",
  "108": "晴れ一時雨か雷雨",
  "110": "晴れ後時々くもり",
  "111": "晴れ後くもり",
  "112": "晴れ後一時雨",
  "113": "晴れ後時々雨",
  "114": "晴れ後雨",
  "115": "晴れ後一時雪",
  "116": "晴れ後時々雪",
  "117": "晴れ後雪",
  "118": "晴れ後雨か雪",
  "119": "晴れ後雨か雷雨",
  "120": "晴れ朝夕一時雨",
  "121": "晴れ朝の内一時雨",
  "122": "晴れ夕方一時雨",
  "123": "晴れ山沿い雷雨",
  "124": "晴れ山沿い雪",
  "125": "晴れ午後は雷雨",
  "126": "晴れ昼頃から雨",
  "127": "晴れ夕方から雨",
  "128": "晴れ夜は雨",
  "130": "朝の内霧後晴れ",
  "131": "晴れ明け方霧",
  "132": "晴れ朝夕くもり",
  "140": "晴れ時々雨で雷を伴う",
  "160": "晴れ一時雪か雨",
  "170": "晴れ時々雪か雨",
  "181": "晴れ後雪か雨",
  "200": "くもり",
  "201": "くもり時々晴れ",
  "202": "くもり一時雨",
  "203": "くもり時々雨",
  "204": "くもり一時雪",
  "205": "くもり時々雪",
  "206": "くもり一時雨か雪",
  "207": "くもり時々雨か雪",
  "208": "くもり一時雨か雷雨",
  "209": "霧",
  "210": "くもり後時々晴れ",
  "211": "くもり後晴れ",
  "212": "くもり後一時雨",
  "213": "くもり後時々雨",
  "214": "くもり後雨",
  "215": "くもり後一時雪",
  "216": "くもり後時々雪",
  "217": "くもり後雪",
  "218": "くもり後雨か雪",
  "219": "くもり後雨か雷雨",
  "220": "くもり朝夕一時雨",
  "221": "くもり朝の内一時雨",
  "222": "くもり夕方一時雨",
  "223": "くもり日中時々晴れ",
  "224": "くもり昼頃から雨",
  "225": "くもり夕方から雨",
  "226": "くもり夜は雨",
  "228": "くもり昼頃から雪",
  "229": "くもり夕方から雪",
  "230": "くもり夜は雪",
  "231": "くもり海上海岸は霧か霧雨",
  "240": "くもり時々雨で雷を伴う",
  "250": "くもり時々雪で雷を伴う",
  "260": "くもり一時雪か雨",
  "270": "くもり時々雪か雨",
  "281": "くもり後雪か雨",
  "300": "雨",
  "301": "雨時々晴れ",
  "302": "雨時々止む",
  "303": "雨時々雪",
  "304": "雨か雪",
  "306": "大雨",
  "308": "雨で暴風を伴う",
  "309": "雨一時雪",
  "311": "雨後晴れ",
  "313": "雨後くもり",
  "314": "雨後時々雪",
  "315": "雨後雪",
  "316": "雨か雪後晴れ",
  "317": "雨か雪後くもり",
  "320": "朝の内雨後晴れ",
  "321": "朝の内雨後くもり",
  "322": "雨朝晩一時雪",
  "323": "雨昼頃から晴れ",
  "324": "雨夕方から晴れ",
  "325": "雨夜は晴れ",
  "326": "雨夕方から雪",
  "327": "雨夜は雪",
  "328": "雨一時強く降る",
  "329": "雨一時みぞれ",
  "340": "雪か雨",
  "350": "雨で雷を伴う",
  "361": "雪か雨後晴れ",
  "371": "雪か雨後くもり",
  "400": "雪",
  "401": "雪時々晴れ",
  "402": "雪時々止む",
  "403": "雪時々雨",
  "405": "大雪",
  "406": "風雪強い",
  "407": "暴風雪",
  "409": "雪一時雨",
  "411": "雪後晴れ",
  "413": "雪後くもり",
  "414": "雪後雨",
  "420": "朝の内雪後晴れ",
  "421": "朝の内雪後くもり",
  "422": "雪昼頃から雨",
  "423": "雪夕方から雨",
  "425": "雪一時強く降る",
  "426": "雪後みぞれ",
  "427": "雪一時みぞれ",
  "450": "雪で雷を伴う",
};

function iconForLabel(label: string, code: string): WeatherIcon {
  // Precipitation tokens win over base sky condition (travelers care about rain/snow).
  if (label.includes("雷")) return "cloud-lightning";
  if (label.includes("雪") || label.includes("みぞれ")) return "cloud-snow";
  if (label.includes("雨")) return "cloud-rain";
  if (label.includes("霧")) return "cloud-fog";
  // No precipitation: refine by base sky condition.
  switch (code[0]) {
    case "1":
      return label.includes("くもり") || label.includes("曇") ? "cloud-sun" : "sun";
    case "2":
      return label.includes("晴") ? "cloud-sun" : "cloud";
    case "3":
      return "cloud-rain";
    case "4":
      return "cloud-snow";
    default:
      return "cloud";
  }
}

// Leading-digit fallback label for codes not present in the table above.
function fallbackLabel(code: string): string {
  switch (code[0]) {
    case "1":
      return "晴れ";
    case "2":
      return "くもり";
    case "3":
      return "雨";
    case "4":
      return "雪";
    default:
      return "不明";
  }
}

// Headline English label per icon. The Japanese telops carry nuance (のち/時々)
// that would require translating ~130 codes; the icon already collapses each
// code to its dominant condition, so a per-icon English label is a faithful,
// low-maintenance headline (the icon, temps, and pop carry the rest).
const ICON_LABEL_EN: Record<WeatherIcon, string> = {
  sun: "Clear",
  "cloud-sun": "Partly cloudy",
  cloud: "Cloudy",
  "cloud-rain": "Rain",
  "cloud-snow": "Snow",
  "cloud-lightning": "Thunderstorms",
  "cloud-fog": "Fog",
};

export type WeatherDisplay = { label: string; labelEn: string; icon: WeatherIcon };

// Resolve a JMA weather code to a display label (ja + en) + icon. Always returns
// a value: unknown codes fall back to the leading-digit category so the UI never
// breaks.
export function getWeatherForCode(code: string): WeatherDisplay {
  const label = WEATHER_CODE_LABELS[code] ?? fallbackLabel(code);
  const icon = iconForLabel(label, code);
  return { label, labelEn: ICON_LABEL_EN[icon], icon };
}
