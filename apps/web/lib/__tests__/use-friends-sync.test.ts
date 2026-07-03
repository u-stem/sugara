import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { broadcastFriendsUpdate, useFriendsSync } from "../hooks/use-friends-sync";

// --- Mocks ---

type SubscribeCallback = (status: string) => void;
type BroadcastHandler = () => void;

function createMockChannel() {
  let subscribeCallback: SubscribeCallback = () => {};
  let broadcastHandler: BroadcastHandler = () => {};
  const channel = {
    on: vi.fn((type: string, _filter: unknown, handler: BroadcastHandler) => {
      if (type === "broadcast") broadcastHandler = handler;
      return channel;
    }),
    subscribe: vi.fn((cb: SubscribeCallback) => {
      subscribeCallback = cb;
      return channel;
    }),
    send: vi.fn(),
    _emitStatus(status: string) {
      subscribeCallback(status);
    },
    _emitBroadcast() {
      broadcastHandler();
    },
  };
  return channel;
}

// Simulate real SDK behavior: removeChannel triggers CLOSED on the channel
const mockRemoveChannel = vi.fn((ch: ReturnType<typeof createMockChannel>) => {
  ch._emitStatus("CLOSED");
});
let mockChannels: ReturnType<typeof createMockChannel>[] = [];

vi.mock("../supabase", () => ({
  supabase: {
    channel: vi.fn(() => {
      const ch = createMockChannel();
      mockChannels.push(ch);
      return ch;
    }),
    removeChannel: (ch: ReturnType<typeof createMockChannel>) => mockRemoveChannel(ch),
  },
}));

const onSync = vi.fn();

describe("useFriendsSync channel lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockChannels = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("subscribes to friends:{userId} channel on mount", async () => {
    const { supabase } = vi.mocked(await import("../supabase"));
    renderHook(() => useFriendsSync("user-1", onSync));

    expect(supabase.channel).toHaveBeenCalledWith("friends:user-1");
    expect(mockChannels).toHaveLength(1);
    expect(mockChannels[0].on).toHaveBeenCalledWith(
      "broadcast",
      { event: "friends:updated" },
      expect.any(Function),
    );
  });

  it("does not subscribe when userId is undefined", () => {
    renderHook(() => useFriendsSync(undefined, onSync));

    expect(mockChannels).toHaveLength(0);
  });

  it("removes channel on unmount", () => {
    const { unmount } = renderHook(() => useFriendsSync("user-1", onSync));
    const channel = mockChannels[0];

    unmount();

    expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
  });
});

describe("useFriendsSync broadcast reception", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockChannels = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls onSync with debounce when broadcast received", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitBroadcast());

    expect(onSync).not.toHaveBeenCalled();

    // Advance past max debounce (300 + 200 jitter)
    act(() => vi.advanceTimersByTime(600));

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("deduplicates rapid broadcasts via debounce", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => {
      mockChannels[0]._emitBroadcast();
      mockChannels[0]._emitBroadcast();
      mockChannels[0]._emitBroadcast();
    });

    act(() => vi.advanceTimersByTime(600));

    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

describe("useFriendsSync reconnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockChannels = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not create a new channel on TIMED_OUT", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitStatus("TIMED_OUT"));

    expect(mockChannels).toHaveLength(1);
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });

  it("does not create a new channel on CHANNEL_ERROR", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitStatus("CHANNEL_ERROR"));

    expect(mockChannels).toHaveLength(1);
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });

  // CLOSED must not trigger a synchronous reconnect: when subscribe flips
  // straight to CLOSED (missing anon key, Realtime auth misconfiguration),
  // an immediate connect() would spin connect→CLOSED→connect in a tight loop.
  it("does not reconnect immediately on CLOSED", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitStatus("CLOSED"));

    expect(mockChannels).toHaveLength(1);
  });

  it("recreates channel after backoff delay on CLOSED", () => {
    renderHook(() => useFriendsSync("user-1", onSync));
    const firstChannel = mockChannels[0];

    act(() => firstChannel._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(1000));

    expect(mockRemoveChannel).toHaveBeenCalledWith(firstChannel);
    expect(mockChannels).toHaveLength(2);
  });

  it("doubles the backoff delay on consecutive CLOSED", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(1000));
    expect(mockChannels).toHaveLength(2);

    // Second consecutive CLOSED → 2s backoff; 1s must not be enough.
    act(() => mockChannels[1]._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(1000));

    expect(mockChannels).toHaveLength(2);
  });

  it("resets the backoff after a successful subscribe", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(1000));
    act(() => mockChannels[1]._emitStatus("SUBSCRIBED"));

    // Attempt counter was reset, so the next CLOSED reconnects after 1s again.
    act(() => mockChannels[1]._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(1000));

    expect(mockChannels).toHaveLength(3);
  });

  it("ignores stale CLOSED from old channel", () => {
    renderHook(() => useFriendsSync("user-1", onSync));
    const firstChannel = mockChannels[0];

    act(() => firstChannel._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(1000));
    expect(mockChannels).toHaveLength(2);

    act(() => firstChannel._emitStatus("CLOSED"));
    act(() => vi.advanceTimersByTime(30_000));
    expect(mockChannels).toHaveLength(2);
  });

  it("cancels a pending reconnect on unmount", () => {
    const { unmount } = renderHook(() => useFriendsSync("user-1", onSync));

    act(() => mockChannels[0]._emitStatus("CLOSED"));
    unmount();
    act(() => vi.advanceTimersByTime(30_000));

    expect(mockChannels).toHaveLength(1);
  });
});

describe("useFriendsSync visibility and network", () => {
  let visibilityState: string;

  beforeEach(() => {
    vi.useFakeTimers();
    mockChannels = [];
    vi.clearAllMocks();
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      get: () => visibilityState,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls onSync when tab becomes visible", () => {
    renderHook(() => useFriendsSync("user-1", onSync));
    onSync.mockClear();

    visibilityState = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("does not disconnect when tab becomes hidden", () => {
    renderHook(() => useFriendsSync("user-1", onSync));

    visibilityState = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });

  it("recreates channel and calls onSync on online event", () => {
    renderHook(() => useFriendsSync("user-1", onSync));
    const firstChannel = mockChannels[0];
    onSync.mockClear();

    act(() => window.dispatchEvent(new Event("online")));

    expect(mockRemoveChannel).toHaveBeenCalledWith(firstChannel);
    expect(mockChannels).toHaveLength(2);
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

describe("broadcastFriendsUpdate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockChannels = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses active channel when available", () => {
    // Mount hook to register active channel for user-1
    renderHook(() => useFriendsSync("user-1", onSync));
    const activeChannel = mockChannels[0];

    broadcastFriendsUpdate("user-1");

    expect(activeChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "friends:updated",
      payload: {},
    });
    // No new channel created
    expect(mockChannels).toHaveLength(1);
  });

  it("creates temporary channel when no active channel exists", () => {
    broadcastFriendsUpdate("user-2");

    expect(mockChannels).toHaveLength(1);
    const temp = mockChannels[0];

    // Simulate successful subscribe
    act(() => temp._emitStatus("SUBSCRIBED"));

    expect(temp.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "friends:updated",
      payload: {},
    });

    // Cleanup after delay
    act(() => vi.advanceTimersByTime(500));
    expect(mockRemoveChannel).toHaveBeenCalledWith(temp);
  });

  it("cleans up temporary channel on CHANNEL_ERROR", () => {
    broadcastFriendsUpdate("user-2");
    const temp = mockChannels[0];

    act(() => temp._emitStatus("CHANNEL_ERROR"));

    expect(mockRemoveChannel).toHaveBeenCalledWith(temp);
    expect(temp.send).not.toHaveBeenCalled();
  });

  it("cleans up temporary channel on TIMED_OUT", () => {
    broadcastFriendsUpdate("user-2");
    const temp = mockChannels[0];

    act(() => temp._emitStatus("TIMED_OUT"));

    expect(mockRemoveChannel).toHaveBeenCalledWith(temp);
    expect(temp.send).not.toHaveBeenCalled();
  });

  it("cleans up temporary channel on CLOSED", () => {
    broadcastFriendsUpdate("user-2");
    const temp = mockChannels[0];

    act(() => temp._emitStatus("CLOSED"));

    expect(mockRemoveChannel).toHaveBeenCalledWith(temp);
    expect(temp.send).not.toHaveBeenCalled();
  });

  it("does not call removeChannel twice when CLOSED fires during cleanup", () => {
    broadcastFriendsUpdate("user-2");
    const temp = mockChannels[0];

    // SUBSCRIBED → send + schedule cleanup
    act(() => temp._emitStatus("SUBSCRIBED"));
    expect(temp.send).toHaveBeenCalledTimes(1);

    // Cleanup fires after 500ms, which triggers CLOSED via removeChannel
    act(() => {
      vi.advanceTimersByTime(500);
      // Simulate CLOSED fired by removeChannel internally
      temp._emitStatus("CLOSED");
    });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });

  it("cleans up active channel map on hook unmount", () => {
    const { unmount } = renderHook(() => useFriendsSync("user-1", onSync));

    unmount();

    // After unmount, broadcastFriendsUpdate should create a temp channel
    broadcastFriendsUpdate("user-1");
    // 1 from hook + 1 temp
    expect(mockChannels).toHaveLength(2);
  });
});
