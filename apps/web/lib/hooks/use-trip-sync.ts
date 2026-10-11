import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sharedTripChannelName } from "../share-channel";
import { supabase } from "../supabase";

export type PresenceUser = {
  userId: string;
  name: string;
  image?: string | null;
  dayId: string | null;
  patternId: string | null;
};

const SYNC_DEBOUNCE_MS = 300;
const SYNC_JITTER_MS = 200;
// Exponential backoff to prevent tight reconnect loops when subscribe flips
// immediately to CLOSED (e.g. missing anon key, Realtime auth misconfiguration).
const CLOSE_RECONNECT_MIN_MS = 1000;
const CLOSE_RECONNECT_MAX_MS = 30_000;

export function useTripSync(
  tripId: string,
  user: { id: string; name: string; image?: string | null } | null,
  onSync: () => void,
  shareChannelKey?: string | null,
): {
  presence: PresenceUser[];
  isConnected: boolean;
  updatePresence: (dayId: string, patternId: string | null) => void;
  broadcastChange: () => void;
  channel: RealtimeChannel | null;
} {
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAttemptsRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const userRef = useRef(user);
  userRef.current = user;
  const lastPresenceRef = useRef<{ dayId: string; patternId: string | null } | null>(null);
  const debouncedSync = useCallback(() => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }
    const delay = SYNC_DEBOUNCE_MS + Math.floor(Math.random() * SYNC_JITTER_MS);
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      onSyncRef.current();
    }, delay);
  }, []);

  useEffect(() => {
    function connect() {
      // Cancel any pending backoff timer so it does not fire against the new channel.
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      disconnect();
      // SECURITY: this channel is public — anyone with the anon key and the tripId can
      // join it and observe Presence. tripId is not a secret: shared-link viewers (via the
      // cover image URL path) and former members can learn it. Real authorization requires
      // private channels, which are designed separately (Phase 3).
      const channel = supabase.channel(`trip:${tripId}`);

      channel
        .on("broadcast", { event: "trip:updated" }, () => {
          debouncedSync();
        })
        .on("presence", { event: "sync" }, () => {
          const state = channel.presenceState<PresenceUser>();
          const users: PresenceUser[] = [];
          const seen = new Set<string>();
          for (const key of Object.keys(state)) {
            for (const p of state[key]) {
              if (p.userId && !seen.has(p.userId)) {
                seen.add(p.userId);
                users.push({
                  userId: p.userId,
                  name: p.name,
                  image: p.image,
                  dayId: p.dayId,
                  patternId: p.patternId,
                });
              }
            }
          }
          setPresence(users);
        })
        .subscribe((status, err) => {
          setIsConnected(status === "SUBSCRIBED");
          if (err) {
            // Surface the underlying reason (auth failure, RLS, etc.) for diagnostics.
            console.warn("[Realtime] subscribe error", { status, err });
          }
          if (status === "SUBSCRIBED") {
            closeAttemptsRef.current = 0;
            toast.dismiss("realtime-error");
            const u = userRef.current;
            const lp = lastPresenceRef.current;
            if (u && lp) {
              channel.track({ userId: u.id, name: u.name, image: u.image, ...lp });
            }
          }
          // SDK's rejoinTimer handles TIMED_OUT / CHANNEL_ERROR automatically
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.debug(`[Realtime] ${status} — SDK will auto-rejoin`);
          }
          // CLOSED means SDK removed the channel; reconnect with exponential backoff
          // so a persistent failure (bad key, blocked auth) doesn't hammer the server.
          if (status === "CLOSED" && channelRef.current === channel) {
            const attempt = ++closeAttemptsRef.current;
            const delay = Math.min(
              CLOSE_RECONNECT_MIN_MS * 2 ** (attempt - 1),
              CLOSE_RECONNECT_MAX_MS,
            );
            console.warn(
              `[Realtime] Channel closed, recreating in ${delay}ms (attempt ${attempt})`,
            );
            if (closeTimerRef.current) {
              clearTimeout(closeTimerRef.current);
            }
            closeTimerRef.current = setTimeout(() => {
              closeTimerRef.current = null;
              // Only reconnect if this closure's channel is still the live one —
              // a later CLOSED or unmount may have already replaced it.
              if (channelRef.current === channel) connect();
            }, delay);
          }
        });

      channelRef.current = channel;
    }

    function disconnect() {
      const channel = channelRef.current;
      // Clear ref before removeChannel to prevent re-entrant CLOSED handling
      channelRef.current = null;
      if (channel) {
        supabase.removeChannel(channel);
      }
      setIsConnected(false);
    }

    // worker: true keeps heartbeat alive in background tabs,
    // so we only refetch data on visibility restore (events may have been missed)
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        onSyncRef.current();
      }
    }

    function handleOnline() {
      // Network recovery is a fresh start; reset attempt counter so the backoff
      // log reports realistic "attempt N" values.
      closeAttemptsRef.current = 0;
      connect();
      onSyncRef.current();
    }

    connect();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      disconnect();
      setPresence([]);
    };
  }, [tripId, debouncedSync]);

  const updatePresence = useCallback((dayId: string, patternId: string | null) => {
    lastPresenceRef.current = { dayId, patternId };
    const u = userRef.current;
    if (!u) return;
    channelRef.current?.track({
      userId: u.id,
      name: u.name,
      image: u.image,
      dayId,
      patternId,
    });
  }, []);

  const shareChannelKeyRef = useRef(shareChannelKey);
  shareChannelKeyRef.current = shareChannelKey;

  const broadcastChange = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "trip:updated",
      payload: {},
    });

    // Also notify shared-link viewers via a separate channel keyed by a one-way hash of
    // the share token. This keeps tripId private (Presence isolation) and never puts the
    // token itself in front of members who are not allowed to issue share links.
    const key = shareChannelKeyRef.current;
    if (!key) return;
    const channelName = sharedTripChannelName(key);
    let cleaned = false;
    const temp = supabase.channel(channelName);
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      supabase.removeChannel(temp);
    };
    temp.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        temp.send({ type: "broadcast", event: "trip:updated", payload: {} });
        setTimeout(cleanup, 500);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        cleanup();
      }
    });
  }, []);

  return {
    presence,
    isConnected,
    updatePresence,
    broadcastChange,
    channel: channelRef.current,
  };
}
