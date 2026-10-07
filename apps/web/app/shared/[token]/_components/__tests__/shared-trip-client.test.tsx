import type { SharedTripResponse } from "@sugara/shared";
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTripSync } from "@/lib/hooks/use-trip-sync";
import { renderWithIntlAndQuery } from "@/lib/test-utils";
import messages from "@/messages/ja.json";

// In-memory Realtime bus: a message sent on a channel name reaches every other
// channel object subscribed to the same name, like Supabase Realtime broadcast.
type Listener = () => void;
const bus = new Map<string, Set<Listener>>();
const subscribedChannelNames: string[] = [];

function createBusChannel(name: string) {
  const registered: Listener[] = [];
  const channel = {
    name,
    on: vi.fn((_type: string, filter: { event: string }, cb: Listener) => {
      if (filter.event === "trip:updated") {
        registered.push(cb);
        const set = bus.get(name) ?? new Set<Listener>();
        set.add(cb);
        bus.set(name, set);
      }
      return channel;
    }),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      subscribedChannelNames.push(name);
      cb?.("SUBSCRIBED");
      return channel;
    }),
    unsubscribe: vi.fn(() => {
      for (const l of registered) bus.get(name)?.delete(l);
    }),
    send: vi.fn((message: { event: string }) => {
      if (message.event !== "trip:updated") return;
      for (const l of bus.get(name) ?? []) l();
    }),
    track: vi.fn(),
    presenceState: vi.fn().mockReturnValue({}),
  };
  return channel;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (name: string) => createBusChannel(name),
    removeChannel: (ch: ReturnType<typeof createBusChannel>) => ch.unsubscribe(),
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), dismiss: vi.fn() },
}));

const mockApi = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { SharedTripClient } from "../shared-trip-client";

const SHARE_TOKEN = "T0kenForRealtimeTests_abcdefghijklmnopqrstuv";
// The key the API derives from the token (SHA-256 hex); opaque to the client.
const CHANNEL_KEY = "a".repeat(64);

const sharedTripFixture: SharedTripResponse = {
  title: "Kyoto Trip",
  destination: "Kyoto",
  startDate: "2025-04-01",
  endDate: "2025-04-01",
  status: "planned",
  days: [],
  candidates: [],
  shareExpiresAt: null,
  shareChannelKey: CHANNEL_KEY,
};

const editor = { id: "editor-1", name: "Editor" };

describe("SharedTripClient realtime updates", () => {
  beforeEach(() => {
    bus.clear();
    subscribedChannelNames.length = 0;
    mockApi.mockResolvedValue(sharedTripFixture);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows the update banner when an editor broadcasts a change with the member-side channel key", async () => {
    renderWithIntlAndQuery(<SharedTripClient token={SHARE_TOKEN} />);
    await screen.findByText("Kyoto Trip");
    const { result } = renderHook(() => useTripSync("trip-1", editor, vi.fn(), CHANNEL_KEY));

    act(() => result.current.broadcastChange());

    expect(await screen.findByText(messages.shared.updateAvailable)).toBeDefined();
  });

  it("does not show the update banner for a change broadcast with a different key", async () => {
    renderWithIntlAndQuery(<SharedTripClient token={SHARE_TOKEN} />);
    await screen.findByText("Kyoto Trip");
    const { result } = renderHook(() => useTripSync("trip-1", editor, vi.fn(), "b".repeat(64)));

    act(() => result.current.broadcastChange());

    expect(screen.queryByText(messages.shared.updateAvailable)).toBeNull();
  });

  it("never opens a channel named after the raw share token", async () => {
    renderWithIntlAndQuery(<SharedTripClient token={SHARE_TOKEN} />);
    await screen.findByText("Kyoto Trip");

    expect(subscribedChannelNames.some((name) => name.includes(SHARE_TOKEN))).toBe(false);
  });

  it("subscribes to the channel derived from the key returned by the shared API", async () => {
    renderWithIntlAndQuery(<SharedTripClient token={SHARE_TOKEN} />);
    await screen.findByText("Kyoto Trip");

    expect(subscribedChannelNames).toContain(`trip-shared:${CHANNEL_KEY}`);
  });
});
