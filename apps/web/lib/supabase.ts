import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55321";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAnonKey && process.env.NODE_ENV === "production") {
  throw new Error("Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey || "", {
  realtime: {
    worker: true,
  },
});

if (typeof window !== "undefined") {
  // Surface transport-level close codes to diagnose Realtime reconnect storms.
  // 1006 = abnormal close, 1008 = policy violation (auth), 4xxx = Phoenix-level.
  // RealtimeClient has no public onClose/onError; stateChangeCallbacks is the
  // documented extension point. Since supabase-js 2.106 (realtime-js 2.106 via
  // @supabase/phoenix) entries are [ref, callback] tuples — Phoenix's
  // triggerStateCallbacks invokes the callback (2nd element) with the event.
  // The ref (1st element) is only used for removal, which we never do, so it is
  // just a label. Guard against future refactors that rename or drop the field —
  // silent failure would leave us with no diagnostics.
  const cbs = supabase.realtime.stateChangeCallbacks;
  if (cbs?.close && cbs.error) {
    cbs.close.push([
      "sugara-diagnostics",
      (e: CloseEvent) => {
        console.warn(
          `[Realtime][socket] close code=${e?.code ?? "?"} reason=${e?.reason || "(none)"}`,
        );
      },
    ]);
    cbs.error.push([
      "sugara-diagnostics",
      (e: Event) => {
        console.warn("[Realtime][socket] error", e);
      },
    ]);
  } else {
    console.warn("[Realtime] stateChangeCallbacks unavailable — socket-level diagnostics disabled");
  }
}
