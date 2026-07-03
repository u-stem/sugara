export {};

const API_URL = process.env.API_URL || "http://localhost:3000";

const DEV_USERS = [
  { name: "開発ユーザー", username: "dev", email: "dev@sugara.local", password: "Password1" },
  { name: "Alice", username: "alice", email: "alice@sugara.local", password: "Password1" },
  { name: "Bob", username: "bob", email: "bob@sugara.local", password: "Password1" },
];

const SAMPLE_TRIP = {
  title: "京都3日間の旅",
  destination: "京都",
  startDate: "2026-03-20",
  endDate: "2026-03-22",
};

const SAMPLE_SCHEDULES = [
  // --- Day 1 ---
  {
    dayIndex: 0,
    name: "東京から京都へ移動",
    category: "transport",
    startTime: "07:30",
    endTime: "09:45",
    departurePlace: "東京駅",
    arrivalPlace: "京都駅",
    transportMethod: "shinkansen",
    color: "orange",
    memo: "のぞみ7号 7号車12A",
    urls: [
      "https://smartex.jr-central.co.jp/",
      "https://railway.jr-central.co.jp/timetable/nr/13/",
    ],
  },
  {
    dayIndex: 0,
    name: "金閣寺",
    category: "sightseeing",
    startTime: "10:30",
    endTime: "12:00",
    address: "京都市北区金閣寺町1",
    urls: [
      "https://www.shokoku-ji.jp/kinkakuji/",
      "https://www.google.com/maps/place/金閣寺",
      "https://ja.wikipedia.org/wiki/鹿苑寺",
    ],
    color: "blue",
    memo: "拝観料: 500円",
  },
  {
    dayIndex: 0,
    name: "金閣寺から嵐山へ移動",
    category: "transport",
    startTime: "12:15",
    endTime: "12:45",
    departurePlace: "金閣寺道",
    arrivalPlace: "嵐山",
    transportMethod: "bus",
    color: "green",
  },
  {
    dayIndex: 0,
    name: "嵐山 竹林の小径",
    category: "sightseeing",
    startTime: "13:00",
    endTime: "14:00",
    address: "京都市右京区嵯峨天龍寺芒ノ馬場町",
  },
  {
    dayIndex: 0,
    name: "湯豆腐 嵯峨野",
    category: "restaurant",
    startTime: "14:15",
    endTime: "15:15",
    address: "京都市右京区嵯峨天龍寺芒ノ馬場町45",
    urls: ["https://www.yudofu-sagano.com/"],
    memo: "予約済み 14:30 / 湯豆腐コース 4,000円",
    color: "red",
  },
  {
    dayIndex: 0,
    name: "嵐山から京都駅へ移動",
    category: "transport",
    startTime: "15:30",
    endTime: "16:15",
    departurePlace: "嵐山",
    arrivalPlace: "京都駅",
    transportMethod: "train",
  },
  {
    dayIndex: 0,
    name: "京都タワーホテル",
    category: "hotel",
    startTime: "17:00",
    endTime: "10:00",
    endDayOffset: 1,
    address: "京都市下京区烏丸通七条下る東塩小路町721-1",
    urls: ["https://www.kyoto-tower-hotel.co.jp/", "https://travel.rakuten.co.jp/HOTEL/8987/"],
    memo: "予約番号: KTH-20260320 / ツイン / 朝食付き 15,800円",
    color: "purple",
  },
  // --- Day 2 ---
  {
    dayIndex: 1,
    name: "京都駅から伏見稲荷へ移動",
    category: "transport",
    startTime: "07:30",
    endTime: "07:45",
    departurePlace: "京都駅",
    arrivalPlace: "稲荷駅",
    transportMethod: "train",
  },
  {
    dayIndex: 1,
    name: "伏見稲荷大社",
    category: "sightseeing",
    startTime: "08:00",
    endTime: "10:00",
    address: "京都市伏見区深草藪之内町68",
    urls: ["https://inari.jp/"],
    color: "red",
  },
  {
    dayIndex: 1,
    name: "稲荷駅から錦市場へ移動",
    category: "transport",
    startTime: "10:15",
    endTime: "10:45",
    departurePlace: "稲荷駅",
    arrivalPlace: "四条駅",
    transportMethod: "train",
    color: "green",
  },
  {
    dayIndex: 1,
    name: "錦市場",
    category: "restaurant",
    startTime: "11:00",
    endTime: "12:30",
    address: "京都市中京区錦小路通",
    memo: "食べ歩き / 箸巻き・たこたまご・漬物",
    color: "orange",
  },
  {
    dayIndex: 1,
    name: "錦市場から清水寺へ移動",
    category: "transport",
    startTime: "13:00",
    endTime: "13:30",
    departurePlace: "四条河原町",
    arrivalPlace: "清水道",
    transportMethod: "bus",
    color: "green",
    memo: "市バス207号系統",
  },
  {
    dayIndex: 1,
    name: "清水寺",
    category: "sightseeing",
    startTime: "14:00",
    endTime: "16:00",
    address: "京都市東山区清水1丁目294",
    urls: ["https://www.kiyomizudera.or.jp/"],
    memo: "拝観料: 400円 / 舞台からの眺望",
    color: "blue",
  },
  {
    dayIndex: 1,
    name: "清水寺から祇園へ散歩",
    category: "transport",
    startTime: "16:00",
    endTime: "16:30",
    departurePlace: "清水寺",
    arrivalPlace: "祇園",
    transportMethod: "walk",
    color: "gray",
  },
  {
    dayIndex: 1,
    name: "祇園散策",
    category: "activity",
    startTime: "16:30",
    endTime: "18:00",
    address: "京都市東山区祇園町",
    memo: "花見小路通り / 八坂神社",
    color: "pink",
  },
  {
    dayIndex: 1,
    name: "祇園から京都駅へ移動",
    category: "transport",
    startTime: "18:15",
    endTime: "18:30",
    departurePlace: "祇園四条駅",
    arrivalPlace: "京都駅",
    transportMethod: "taxi",
    color: "yellow",
    memo: "約1,500円",
  },
  {
    dayIndex: 1,
    name: "京都駅ビル 拉麺小路",
    category: "restaurant",
    startTime: "18:45",
    endTime: "19:30",
    address: "京都市下京区東塩小路町 京都駅ビル10F",
  },
  {
    dayIndex: 1,
    name: "ホテルグランヴィア京都",
    category: "hotel",
    startTime: "20:00",
    endTime: "09:00",
    endDayOffset: 1,
    address: "京都市下京区烏丸通塩小路下る JR京都駅中央口",
    urls: ["https://www.granvia-kyoto.co.jp/"],
    memo: "予約番号: GV-88432 / デラックスツイン / 22,000円",
    color: "purple",
  },
  // --- Day 3 ---
  {
    dayIndex: 2,
    name: "ホテルから銀閣寺へ移動",
    category: "transport",
    startTime: "09:30",
    endTime: "10:00",
    departurePlace: "京都駅",
    arrivalPlace: "銀閣寺道",
    transportMethod: "bus",
    color: "green",
  },
  {
    dayIndex: 2,
    name: "銀閣寺",
    category: "sightseeing",
    startTime: "10:00",
    endTime: "11:00",
    address: "京都市左京区銀閣寺町2",
    urls: ["https://www.shokoku-ji.jp/ginkakuji/"],
    memo: "拝観料: 500円",
    color: "blue",
  },
  {
    dayIndex: 2,
    name: "哲学の道 散策",
    category: "activity",
    startTime: "11:00",
    endTime: "12:00",
    address: "京都市左京区浄土寺石橋町",
    memo: "桜の季節は特におすすめ",
    color: "pink",
  },
  {
    dayIndex: 2,
    name: "おめん 銀閣寺本店",
    category: "restaurant",
    startTime: "12:00",
    endTime: "13:00",
    address: "京都市左京区浄土寺石橋町74",
    urls: ["https://www.omen.co.jp/"],
    memo: "名物うどん / 予約不要",
    color: "red",
  },
  {
    dayIndex: 2,
    name: "京都から東京へ移動",
    category: "transport",
    startTime: "14:00",
    endTime: "16:15",
    departurePlace: "京都駅",
    arrivalPlace: "東京駅",
    transportMethod: "shinkansen",
    color: "orange",
    memo: "のぞみ32号 自由席",
  },
  // Long data: long name, long address, long memo, many URLs
  {
    dayIndex: 2,
    name: "京都伝統産業ミュージアム（京都市勧業館みやこめっせ地下1階）",
    category: "sightseeing",
    startTime: "11:30",
    endTime: "12:30",
    address: "京都市左京区岡崎成勝寺町9番地の1 京都市勧業館みやこめっせ 地下1階",
    urls: [
      "https://kmtc.jp/",
      "https://www.google.com/maps/place/京都伝統産業ミュージアム",
      "https://ja.wikipedia.org/wiki/京都伝統産業ミュージアム",
      "https://www.tripadvisor.jp/Attraction_Review-g298564-d1386890-Reviews",
      "https://www.jalan.net/kankou/spt_26103cc3290031914/",
    ],
    memo: "入館無料 / 西陣織・京友禅・清水焼・京漆器など74品目の伝統工芸品を展示 / 体験コーナーあり（要予約・別途料金）/ 所要時間の目安は60〜90分",
    color: "yellow",
  },
];

const SAMPLE_CANDIDATES = [
  // sightseeing: URL multiple + address + memo
  {
    name: "二条城",
    category: "sightseeing",
    address: "京都市中京区二条通堀川西入二条城町541",
    memo: "世界遺産 / 二の丸御殿のうぐいす張りが有名",
    urls: ["https://nijo-jocastle.city.kyoto.lg.jp/", "https://www.google.com/maps/place/二条城"],
    color: "blue",
  },
  // sightseeing: URL single only
  {
    name: "鈴虫寺",
    category: "sightseeing",
    urls: ["https://www.suzutera.or.jp/"],
  },
  // sightseeing: memo only, no URL
  {
    name: "天龍寺",
    category: "sightseeing",
    memo: "嵐山にあるので竹林の小径とセットで回れる",
  },
  // restaurant: URL + memo + address + time
  {
    name: "% Arabica 京都 東山",
    category: "restaurant",
    address: "京都市東山区星野町87-5",
    urls: ["https://arabica.coffee/"],
    memo: "八坂の塔の近く / テイクアウトのみ",
    startTime: "09:00",
    endTime: "10:00",
    color: "red",
  },
  // restaurant: memo only
  {
    name: "出町ふたば",
    category: "restaurant",
    memo: "名代豆餅 / 行列必須",
  },
  // activity: URL only
  {
    name: "京都サイクリングツアー",
    category: "activity",
    urls: ["https://www.kctp.net/"],
    color: "green",
  },
  // activity: multiple URLs + memo
  {
    name: "着物レンタル 夢館",
    category: "activity",
    memo: "祇園散策用 / 要予約",
    urls: ["https://www.yumeyakata.com/", "https://www.yumeyakata.com/plan/"],
    color: "pink",
  },
  // transport: candidate with route info
  {
    name: "京都〜奈良 近鉄特急",
    category: "transport",
    departurePlace: "京都駅",
    arrivalPlace: "近鉄奈良駅",
    transportMethod: "train",
    memo: "片道約35分 / 特急料金520円",
    urls: ["https://www.kintetsu.co.jp/"],
    color: "orange",
  },
  // hotel: address + multiple URLs + time
  {
    name: "THE THOUSAND KYOTO",
    category: "hotel",
    address: "京都市下京区東塩小路町570",
    startTime: "15:00",
    endTime: "11:00",
    urls: [
      "https://www.the-thousand-kyoto.jp/",
      "https://travel.rakuten.co.jp/HOTEL/176498/",
      "https://www.booking.com/hotel/jp/the-thousand-kyoto.html",
    ],
    memo: "京都駅直結 / 朝食ビュッフェが人気",
    color: "purple",
  },
  // other: memo only, no URL/address
  {
    name: "京都駅ビル 大階段",
    category: "other",
    memo: "夜のイルミネーションがきれい",
  },
  // sightseeing: minimal (name + category only)
  {
    name: "平等院鳳凰堂",
    category: "sightseeing",
  },
  // Long data: long name, long address, long memo, max URLs, long route
  {
    name: "京都鉄道博物館（旧梅小路蒸気機関車館・旧交通科学博物館）",
    category: "sightseeing",
    address: "京都市下京区観喜寺町 梅小路公園内 京都鉄道博物館",
    urls: [
      "https://www.kyotorailwaymuseum.jp/",
      "https://www.google.com/maps/place/京都鉄道博物館",
      "https://www.tripadvisor.jp/Attraction_Review-g298564-d10020717-Reviews",
      "https://www.jalan.net/kankou/spt_guide000000190292/",
      "https://ja.wikipedia.org/wiki/京都鉄道博物館",
    ],
    memo: "入館料: 大人1,500円 / SLスチーム号の乗車体験あり（別途300円）/ 日本最大級の鉄道博物館で所要時間は2〜3時間 / 梅小路公園の散歩もおすすめ",
    startTime: "10:00",
    endTime: "13:00",
    color: "orange",
  },
  {
    name: "嵐山〜貴船 1日観光タクシープラン（MKタクシー）",
    category: "transport",
    departurePlace: "京都駅八条口 MKタクシーのりば",
    arrivalPlace: "貴船神社前（叡山電車 貴船口駅経由）",
    transportMethod: "taxi",
    memo: "所要約6時間 / 嵐山→天龍寺→竹林→大覚寺→鷹峯→貴船を巡るコース / 要事前予約（2日前まで）/ 料金目安: 35,000円〜",
    urls: ["https://www.mktaxi-japan.com/"],
    color: "yellow",
  },
];

const SAMPLE_SOUVENIRS_DEV: {
  name: string;
  recipient?: string;
  addresses?: string[];
  urls?: string[];
  memo?: string;
  isPurchased: boolean;
}[] = [
  {
    name: "八ツ橋",
    recipient: "職場へのお土産",
    addresses: ["京都市左京区聖護院西町7", "京都市下京区東塩小路町 京都駅構内"],
    memo: "つぶあん入りと生八ツ橋を各2箱",
    isPurchased: true,
  },
  {
    name: "宇治抹茶 小山園",
    urls: ["https://www.horaido.co.jp/"],
    memo: "抹茶ラテ用に粉末タイプ",
    isPurchased: false,
  },
  {
    name: "清水焼 湯呑み",
    addresses: ["京都市東山区清水2丁目"],
    memo: "清水坂の陶器屋で探す",
    isPurchased: false,
  },
  {
    name: "京都限定ポッキー",
    recipient: "友達へ",
    isPurchased: false,
  },
];

const SAMPLE_SOUVENIRS_ALICE = [
  {
    name: "西陣織 がま口",
    memo: "自分用",
  },
  {
    name: "金平糖 緑寿庵清水",
    addresses: ["京都市左京区吉田泉殿町38-2"],
    urls: ["https://www.konpeito.co.jp/"],
    memo: "季節限定フレーバーをチェック",
  },
];

const SAMPLE_POLL_TRIP = {
  title: "沖縄旅行",
  destination: "沖縄",
  pollOptions: [
    { startDate: "2026-04-10", endDate: "2026-04-12" },
    { startDate: "2026-04-17", endDate: "2026-04-19" },
    { startDate: "2026-04-24", endDate: "2026-04-27" },
  ],
};

const SAMPLE_BOOKMARK_LISTS = [
  {
    name: "京都グルメ",
    visibility: "private" as const,
    bookmarks: [
      {
        name: "出町ふたば",
        memo: "名代豆餅が有名。行列必須だが並ぶ価値あり",
        url: "https://tabelog.com/kyoto/A2601/A260302/26001520/",
      },
      {
        name: "中村藤吉本店",
        memo: "宇治抹茶スイーツの老舗",
        url: "https://www.tokichi.jp/",
      },
      {
        name: "% Arabica 京都 東山",
        url: "https://arabica.coffee/",
      },
      {
        name: "錦市場 食べ歩き",
        memo: "箸巻き・たこたまご・漬物がおすすめ",
      },
      {
        name: "湯豆腐 嵯峨野",
        memo: "嵐山の湯豆腐コース 4,000円",
        url: "https://www.yudofu-sagano.com/",
      },
      {
        name: "イノダコーヒ 本店",
        memo: "レトロな喫茶店。京の朝食セットが人気",
        url: "https://www.inoda-coffee.co.jp/",
      },
      {
        name: "ぎおん徳屋",
        memo: "本わらびもちが絶品",
      },
    ],
  },
  {
    name: "行きたい場所",
    visibility: "friends_only" as const,
    bookmarks: [
      {
        name: "チームラボ ボーダレス 麻布台",
        url: "https://www.teamlab.art/jp/e/borderless-azabudai/",
      },
      {
        name: "根津美術館",
        memo: "庭園も見どころ。国宝「燕子花図屏風」は春の特別展示",
        url: "https://www.nezu-muse.or.jp/",
      },
      {
        name: "鎌倉 報国寺",
        memo: "竹の庭で抹茶",
        url: "https://houkokuji.or.jp/",
      },
      {
        name: "直島",
        memo: "ベネッセアートサイト。フェリーで渡る",
      },
      {
        name: "屋久島 縄文杉トレッキング",
        memo: "往復10時間。体力に自信がある時に",
      },
    ],
  },
  {
    name: "旅行持ち物リスト",
    visibility: "public" as const,
    bookmarks: [
      { name: "パスポート" },
      { name: "充電器・モバイルバッテリー" },
      { name: "常備薬" },
      {
        name: "海外旅行保険",
        url: "https://www.sompo-japan.co.jp/kinsurance/leisure/off/",
      },
      { name: "変換プラグ", memo: "渡航先のコンセント形状を事前確認" },
    ],
  },
];

type ApiResponse = Record<string, unknown>;

async function apiFetch<T = ApiResponse>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

type DevUser = {
  name: string;
  username: string;
  email: string;
  password: string;
};

async function signupOrLogin(user: DevUser): Promise<{ cookies: string; userId: string }> {
  const res = await fetch(`${API_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
    redirect: "manual",
  });
  let cookies = res.headers.getSetCookie?.().join("; ") ?? "";
  if (!res.ok && res.status !== 302) {
    const body = await res.text();
    if (body.includes("already") || body.includes("exist")) {
      console.log("  Already exists, logging in...");
      const loginRes = await fetch(`${API_URL}/api/auth/sign-in/username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.username, password: user.password }),
        redirect: "manual",
      });
      cookies = loginRes.headers.getSetCookie?.().join("; ") ?? "";
      if (!loginRes.ok && loginRes.status !== 302) {
        throw new Error(`Login failed: ${await loginRes.text()}`);
      }
    } else {
      throw new Error(`Signup failed: ${body}`);
    }
  }

  // Fetch user ID from session
  const sessionRes = await fetch(`${API_URL}/api/auth/get-session`, {
    headers: { cookie: cookies },
  });
  const session = (await sessionRes.json()) as { user: { id: string } };
  return { cookies, userId: session.user.id };
}

async function tryCreate<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes("409")) return null;
    throw err;
  }
}

async function main() {
  // Dev seed creates users with a well-known password — refuse to run against
  // anything but localhost unless explicitly overridden.
  const host = new URL(API_URL).hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (!isLocalhost && process.env.ALLOW_REMOTE_SEED !== "1") {
    console.error(`Error: refusing to seed non-local API_URL (${API_URL}).`);
    console.error("Set ALLOW_REMOTE_SEED=1 to override.");
    process.exit(1);
  }

  console.log("Seeding database...");
  console.log(`API: ${API_URL}`);

  // 1. Create all dev users
  const userMap = new Map<string, { cookies: string; userId: string }>();
  for (const user of DEV_USERS) {
    console.log(`\nCreating user: ${user.username}`);
    try {
      const result = await signupOrLogin(user);
      userMap.set(user.username, result);
      console.log(`  Done (ID: ${result.userId})`);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes("fetch")) {
        console.error(`\nError: API server is not running at ${API_URL}`);
        console.error("Run 'bun run dev' first, then try again.\n");
        process.exit(1);
      }
      throw err;
    }
  }

  const ownerData = userMap.get(DEV_USERS[0].username);
  if (!ownerData) throw new Error(`Data not found for ${DEV_USERS[0].username}`);
  const ownerCookies = ownerData.cookies;
  const aliceData = userMap.get("alice");
  const bobData = userMap.get("bob");

  // Fetch existing data to check for duplicates
  const existingTrips = await apiFetch<{ id: string; title: string }[]>("/api/trips", {
    headers: { cookie: ownerCookies },
  });
  const existingGroups = await apiFetch<{ id: string; name: string }[]>("/api/groups", {
    headers: { cookie: ownerCookies },
  });
  const existingBookmarkLists = await apiFetch<{ id: string; name: string }[]>(
    "/api/bookmark-lists",
    { headers: { cookie: ownerCookies } },
  );

  // 2. Create sample trip (skip if already exists)
  console.log(`\nCreating trip: ${SAMPLE_TRIP.title}`);
  const existingKyotoTrip = existingTrips.find((t) => t.title === SAMPLE_TRIP.title);
  if (existingKyotoTrip) {
    console.log(`  Already exists (ID: ${existingKyotoTrip.id}), skipping`);
  } else {
    const trip = await apiFetch<{ id: string }>("/api/trips", {
      method: "POST",
      body: JSON.stringify(SAMPLE_TRIP),
      headers: { cookie: ownerCookies },
    });
    console.log(`  Trip ID: ${trip.id}`);

    // 3. Fetch trip details to get day IDs and default pattern IDs
    const tripDetail = await apiFetch<{
      days: { id: string; dayNumber: number; patterns: { id: string; isDefault: boolean }[] }[];
    }>(`/api/trips/${trip.id}`, { headers: { cookie: ownerCookies } });
    const days = tripDetail.days.sort((a, b) => a.dayNumber - b.dayNumber);

    // 4. Create schedules
    console.log(`\nCreating ${SAMPLE_SCHEDULES.length} schedules...`);
    for (const schedule of SAMPLE_SCHEDULES) {
      const day = days[schedule.dayIndex];
      if (!day) continue;
      const defaultPattern = day.patterns.find((v) => v.isDefault) ?? day.patterns[0];
      if (!defaultPattern) continue;
      const { dayIndex: _, ...scheduleData } = schedule;
      await apiFetch(
        `/api/trips/${trip.id}/days/${day.id}/patterns/${defaultPattern.id}/schedules`,
        {
          method: "POST",
          body: JSON.stringify(scheduleData),
          headers: { cookie: ownerCookies },
        },
      );
      console.log(`  ${day.dayNumber}日目: ${schedule.name}`);
    }

    // 5. Create candidates
    console.log(`\nCreating ${SAMPLE_CANDIDATES.length} candidates...`);
    for (const candidate of SAMPLE_CANDIDATES) {
      await apiFetch(`/api/trips/${trip.id}/candidates`, {
        method: "POST",
        body: JSON.stringify(candidate),
        headers: { cookie: ownerCookies },
      });
      console.log(`  候補: ${candidate.name}`);
    }

    // 6. Add other users as trip members
    const memberRoles = ["editor", "viewer"] as const;
    for (let i = 1; i < DEV_USERS.length; i++) {
      const user = DEV_USERS[i];
      const role = memberRoles[i - 1] ?? "editor";
      const userData = userMap.get(user.username);
      if (!userData) continue;
      console.log(`\nAdding member: ${user.username} (${role})`);
      await apiFetch(`/api/trips/${trip.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: userData.userId, role }),
        headers: { cookie: ownerCookies },
      });
      console.log("  Done");
    }

    // 7. Create expenses
    const expenseUsers = {
      dev: ownerData.userId,
      alice: aliceData?.userId,
      bob: bobData?.userId,
    };
    const sampleExpenses = [
      {
        title: "新幹線 東京→京都",
        amount: 43560,
        paidBy: "dev" as const,
        splitType: "equal" as const,
        category: "transportation" as const,
        splitWith: ["dev", "alice", "bob"] as const,
      },
      {
        title: "湯豆腐 嵯峨野",
        amount: 12000,
        paidBy: "alice" as const,
        splitType: "equal" as const,
        category: "meals" as const,
        splitWith: ["dev", "alice", "bob"] as const,
      },
      {
        title: "京都タワーホテル",
        amount: 47400,
        paidBy: "dev" as const,
        splitType: "equal" as const,
        category: "accommodation" as const,
        splitWith: ["dev", "alice", "bob"] as const,
      },
      {
        title: "錦市場 食べ歩き",
        amount: 4500,
        paidBy: "bob" as const,
        splitType: "equal" as const,
        category: "meals" as const,
        splitWith: ["dev", "alice", "bob"] as const,
      },
      {
        title: "タクシー 祇園→京都駅",
        amount: 1500,
        paidBy: "alice" as const,
        splitType: "custom" as const,
        category: "transportation" as const,
        customSplits: [
          { user: "dev" as const, amount: 500 },
          { user: "alice" as const, amount: 500 },
          { user: "bob" as const, amount: 500 },
        ],
      },
      {
        title: "ホテルグランヴィア京都",
        amount: 66000,
        paidBy: "dev" as const,
        splitType: "custom" as const,
        category: "accommodation" as const,
        customSplits: [
          { user: "dev" as const, amount: 22000 },
          { user: "alice" as const, amount: 22000 },
          { user: "bob" as const, amount: 22000 },
        ],
      },
      {
        title: "おめん 銀閣寺本店",
        amount: 4200,
        paidBy: "bob" as const,
        splitType: "equal" as const,
        category: "meals" as const,
        splitWith: ["dev", "alice", "bob"] as const,
      },
      {
        title: "先斗町 居酒屋",
        amount: 15000,
        paidBy: "alice" as const,
        splitType: "itemized" as const,
        category: "meals" as const,
        customSplits: [
          { user: "dev" as const, amount: 3800 },
          { user: "alice" as const, amount: 4500 },
          { user: "bob" as const, amount: 6700 },
        ],
        lineItemsDef: [
          { name: "お通し", amount: 1500, users: ["dev", "alice", "bob"] as const },
          { name: "刺身盛り合わせ", amount: 3500, users: ["dev", "alice", "bob"] as const },
          { name: "日本酒", amount: 5000, users: ["dev", "alice"] as const },
          { name: "ソフトドリンク", amount: 1000, users: ["bob"] as const },
          { name: "デザート", amount: 4000, users: ["dev", "alice", "bob"] as const },
        ],
      },
      {
        // Foreign-currency equal split (USD): split amounts are converted to the
        // trip currency (JPY) on save, so they aggregate cleanly per member.
        title: "Klook 嵐山トロッコ事前予約",
        amount: 30,
        paidBy: "dev" as const,
        splitType: "equal" as const,
        category: "entertainment" as const,
        splitWith: ["dev", "alice", "bob"] as const,
        currency: "USD" as const,
        exchangeRate: 150,
      },
      {
        // Foreign-currency custom split in a decimals=0 currency (KRW). Exercises
        // the per-member conversion and the foreign-split settlement fix.
        title: "ロッテ免税店 オンライン事前予約",
        amount: 60000,
        paidBy: "alice" as const,
        splitType: "custom" as const,
        category: "supplies" as const,
        customSplits: [
          { user: "dev" as const, amount: 20000 },
          { user: "alice" as const, amount: 20000 },
          { user: "bob" as const, amount: 20000 },
        ],
        currency: "KRW" as const,
        exchangeRate: 0.11,
      },
    ];

    console.log(`\nCreating ${sampleExpenses.length} expenses...`);
    for (const exp of sampleExpenses) {
      const paidByUserId = expenseUsers[exp.paidBy];
      if (!paidByUserId) continue;
      const splits =
        (exp.splitType === "custom" || exp.splitType === "itemized") && exp.customSplits
          ? exp.customSplits
              .map((s) => {
                const userId = expenseUsers[s.user];
                return userId ? { userId, amount: s.amount } : null;
              })
              .filter((s): s is { userId: string; amount: number } => s !== null)
          : (exp.splitWith ?? [])
              .map((username) => {
                const userId = expenseUsers[username];
                return userId ? { userId } : null;
              })
              .filter((s): s is { userId: string } => s !== null);

      const lineItemsPayload =
        "lineItemsDef" in exp && exp.lineItemsDef
          ? exp.lineItemsDef.map((li) => ({
              name: li.name,
              amount: li.amount,
              memberIds: li.users.map((u) => expenseUsers[u]).filter((id): id is string => !!id),
            }))
          : undefined;

      await apiFetch(`/api/trips/${trip.id}/expenses`, {
        method: "POST",
        body: JSON.stringify({
          title: exp.title,
          amount: exp.amount,
          paidByUserId,
          splitType: exp.splitType,
          splits,
          ...("category" in exp && exp.category ? { category: exp.category } : {}),
          ...("currency" in exp && exp.currency ? { currency: exp.currency } : {}),
          ...("exchangeRate" in exp && exp.exchangeRate ? { exchangeRate: exp.exchangeRate } : {}),
          ...(lineItemsPayload ? { lineItems: lineItemsPayload } : {}),
        }),
        headers: { cookie: ownerCookies },
      });
      const unit = "currency" in exp && exp.currency ? ` ${exp.currency}` : "円";
      console.log(`  費用: ${exp.title} (${exp.amount.toLocaleString()}${unit})`);
    }

    // 8. Mark first settlement transfer as paid
    console.log("\nCreating settlement payments...");
    const expensesRes = await apiFetch<{
      settlement: {
        transfers: {
          from: { id: string; name: string };
          to: { id: string; name: string };
          amount: number;
        }[];
      };
    }>(`/api/trips/${trip.id}/expenses`, { headers: { cookie: ownerCookies } });
    const firstTransfer = expensesRes.settlement.transfers[0];
    if (firstTransfer) {
      await apiFetch(`/api/trips/${trip.id}/settlement-payments`, {
        method: "POST",
        body: JSON.stringify({
          fromUserId: firstTransfer.from.id,
          toUserId: firstTransfer.to.id,
          amount: firstTransfer.amount,
        }),
        headers: { cookie: ownerCookies },
      });
      console.log(
        `  精算済み: ${firstTransfer.from.name} → ${firstTransfer.to.name} (${firstTransfer.amount.toLocaleString()}円)`,
      );
      if (expensesRes.settlement.transfers.length > 1) {
        const remaining = expensesRes.settlement.transfers.slice(1);
        for (const t of remaining) {
          console.log(`  未精算: ${t.from.name} → ${t.to.name} (${t.amount.toLocaleString()}円)`);
        }
      }
    }

    // 9. Create souvenirs
    console.log("\nCreating souvenirs...");
    for (const { isPurchased, ...souvenirData } of SAMPLE_SOUVENIRS_DEV) {
      const created = await apiFetch<{ id: string }>(`/api/trips/${trip.id}/souvenirs`, {
        method: "POST",
        body: JSON.stringify(souvenirData),
        headers: { cookie: ownerCookies },
      });
      if (isPurchased) {
        await apiFetch(`/api/trips/${trip.id}/souvenirs/${created.id}`, {
          method: "PATCH",
          body: JSON.stringify({ isPurchased: true }),
          headers: { cookie: ownerCookies },
        });
      }
      console.log(`  dev: ${souvenirData.name}${isPurchased ? " (購入済み)" : ""}`);
    }
    if (aliceData) {
      for (const souvenirData of SAMPLE_SOUVENIRS_ALICE) {
        await apiFetch(`/api/trips/${trip.id}/souvenirs`, {
          method: "POST",
          body: JSON.stringify(souvenirData),
          headers: { cookie: aliceData.cookies },
        });
        console.log(`  alice: ${souvenirData.name}`);
      }
    }
  }

  // 10. Create poll trip (skip if already exists)
  console.log(`\nCreating poll trip: ${SAMPLE_POLL_TRIP.title}`);
  const existingPollTrip = existingTrips.find((t) => t.title === SAMPLE_POLL_TRIP.title);
  if (existingPollTrip) {
    console.log(`  Already exists (ID: ${existingPollTrip.id}), skipping`);
  } else {
    const pollTrip = await apiFetch<{ id: string }>("/api/trips", {
      method: "POST",
      body: JSON.stringify(SAMPLE_POLL_TRIP),
      headers: { cookie: ownerCookies },
    });
    console.log(`  Trip ID: ${pollTrip.id}`);

    const pollTripDetail = await apiFetch<{ poll: { id: string } }>(`/api/trips/${pollTrip.id}`, {
      headers: { cookie: ownerCookies },
    });
    const seedPollId = pollTripDetail.poll.id;
    console.log(`  Poll ID: ${seedPollId}`);

    // Add alice and bob as trip members first, then poll participants
    // (participant endpoint requires user to be a trip member)
    for (const username of ["alice", "bob"] as const) {
      const userData = userMap.get(username);
      if (!userData) continue;
      await tryCreate(() =>
        apiFetch(`/api/trips/${pollTrip.id}/members`, {
          method: "POST",
          body: JSON.stringify({ userId: userData.userId, role: "editor" }),
          headers: { cookie: ownerCookies },
        }),
      );
      await tryCreate(() =>
        apiFetch(`/api/polls/${seedPollId}/participants`, {
          method: "POST",
          body: JSON.stringify({ userId: userData.userId }),
          headers: { cookie: ownerCookies },
        }),
      );
      console.log(`  Member + participant: ${username}`);
    }

    // Fetch option IDs and submit responses
    const pollDetail = await apiFetch<{
      options: { id: string; startDate: string }[];
    }>(`/api/polls/${seedPollId}`, { headers: { cookie: ownerCookies } });
    const optionsByDate = new Map(pollDetail.options.map((o) => [o.startDate, o.id]));
    const opt1 = optionsByDate.get("2026-04-10");
    const opt2 = optionsByDate.get("2026-04-17");
    const opt3 = optionsByDate.get("2026-04-24");
    if (!opt1 || !opt2 || !opt3) throw new Error("Expected poll options not found by date");

    type PollResponse = { optionId: string; response: "ok" | "maybe" | "ng" };

    const devResponses: PollResponse[] = [
      { optionId: opt1, response: "ok" },
      { optionId: opt2, response: "ok" },
      { optionId: opt3, response: "maybe" },
    ];
    await apiFetch(`/api/polls/${seedPollId}/responses`, {
      method: "PUT",
      body: JSON.stringify({ responses: devResponses }),
      headers: { cookie: ownerCookies },
    });
    console.log("  Response: dev");

    if (aliceData) {
      const aliceResponses: PollResponse[] = [
        { optionId: opt1, response: "ok" },
        { optionId: opt2, response: "maybe" },
        { optionId: opt3, response: "ng" },
      ];
      await apiFetch(`/api/polls/${seedPollId}/responses`, {
        method: "PUT",
        body: JSON.stringify({ responses: aliceResponses }),
        headers: { cookie: aliceData.cookies },
      });
      console.log("  Response: alice");
    }

    if (bobData) {
      const bobResponses: PollResponse[] = [
        { optionId: opt1, response: "maybe" },
        { optionId: opt2, response: "ok" },
      ];
      await apiFetch(`/api/polls/${seedPollId}/responses`, {
        method: "PUT",
        body: JSON.stringify({ responses: bobResponses }),
        headers: { cookie: bobData.cookies },
      });
      console.log("  Response: bob");
    }
  }

  // 11. Create friend relationships (skip if already friends)
  console.log("\nCreating friend relationships...");

  async function ensureFriends(
    requesterCookies: string,
    accepterCookies: string,
    accepterId: string,
    label: string,
  ) {
    const req = await tryCreate(() =>
      apiFetch<{ id: string }>("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ addresseeId: accepterId }),
        headers: { cookie: requesterCookies },
      }),
    );
    if (req) {
      await apiFetch(`/api/friends/requests/${req.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "accepted" }),
        headers: { cookie: accepterCookies },
      });
      console.log(`  ${label}: friends`);
    } else {
      console.log(`  ${label}: already friends`);
    }
  }

  if (aliceData) {
    await ensureFriends(ownerCookies, aliceData.cookies, aliceData.userId, "dev <-> alice");
  }
  if (bobData) {
    await ensureFriends(ownerCookies, bobData.cookies, bobData.userId, "dev <-> bob");
  }
  if (aliceData && bobData) {
    await ensureFriends(aliceData.cookies, bobData.cookies, bobData.userId, "alice <-> bob");
  }

  // 12. Create groups with members (skip if already exists)
  console.log("\nCreating groups...");

  async function ensureGroup(name: string, memberUserIds: string[], label: string) {
    if (existingGroups.some((g) => g.name === name)) {
      console.log(`  ${label}: already exists`);
      return;
    }
    const group = await apiFetch<{ id: string }>("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name }),
      headers: { cookie: ownerCookies },
    });
    for (const userId of memberUserIds) {
      await apiFetch(`/api/groups/${group.id}/members`, {
        method: "POST",
        body: JSON.stringify({ userId }),
        headers: { cookie: ownerCookies },
      });
    }
    console.log(`  ${label}`);
  }

  await ensureGroup(
    "京都メンバー",
    [aliceData?.userId, bobData?.userId].filter((id): id is string => !!id),
    "京都メンバー (dev所有, alice + bob)",
  );
  await ensureGroup(
    "家族",
    [aliceData?.userId].filter((id): id is string => !!id),
    "家族 (dev所有, alice)",
  );

  // 13. Create bookmark lists with bookmarks (skip if already exists)
  console.log(`\nCreating ${SAMPLE_BOOKMARK_LISTS.length} bookmark lists...`);
  for (const listData of SAMPLE_BOOKMARK_LISTS) {
    if (existingBookmarkLists.some((l) => l.name === listData.name)) {
      console.log(`  リスト: ${listData.name}: already exists`);
      continue;
    }
    const { bookmarks: bms, ...listBody } = listData;
    const list = await apiFetch<{ id: string }>("/api/bookmark-lists", {
      method: "POST",
      body: JSON.stringify(listBody),
      headers: { cookie: ownerCookies },
    });
    console.log(`  リスト: ${listData.name} (${bms.length}件)`);
    for (const bm of bms) {
      await apiFetch(`/api/bookmark-lists/${list.id}/bookmarks`, {
        method: "POST",
        body: JSON.stringify(bm),
        headers: { cookie: ownerCookies },
      });
    }
  }

  console.log("\n--- Seed complete ---");
  console.log("\nTest accounts:");
  const memberRoles = ["owner", "editor", "viewer"] as const;
  for (let i = 0; i < DEV_USERS.length; i++) {
    const user = DEV_USERS[i];
    console.log(`  ${user.username} / ${"*".repeat(user.password.length)} (${memberRoles[i]})`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
