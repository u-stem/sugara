import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();

vi.mock("../../db/index", async () => {
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

vi.mock("../../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

import { eq } from "drizzle-orm";
import {
  schedulePollOptions,
  schedulePollParticipants,
  schedulePollResponses,
  schedulePolls,
  tripDays,
  tripMembers,
  trips,
} from "../../db/schema";
import { pollShareRoutes } from "../../routes/poll-share";
import { pollRoutes } from "../../routes/polls";
import { tripRoutes } from "../../routes/trips";
import { cleanupTables, createTestUser, getTestDb, teardownTestDb } from "./setup";

function createApp() {
  const app = new Hono();
  app.route("/api/trips", tripRoutes);
  app.route("/api/polls", pollRoutes);
  app.route("/", pollShareRoutes);
  return app;
}

function json(body: unknown) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function patch(body: unknown) {
  return {
    method: "PATCH" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function put(body: unknown) {
  return {
    method: "PUT" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

const VALID_TRIP_WITH_POLL = {
  title: "Summer Trip",
  destination: "Okinawa",
  pollOptions: [
    { startDate: "2025-07-01", endDate: "2025-07-03" },
    { startDate: "2025-07-10", endDate: "2025-07-12" },
  ],
};

/** Create a trip with poll mode, return { tripId, pollId, poll } */
async function createTripWithPoll(app: Hono, overrides?: Partial<typeof VALID_TRIP_WITH_POLL>) {
  const res = await app.request("/api/trips", json({ ...VALID_TRIP_WITH_POLL, ...overrides }));
  const trip = await res.json();
  const db = getTestDb();
  const poll = await db.query.schedulePolls.findFirst({
    where: eq(schedulePolls.tripId, trip.id),
    with: { options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] }, participants: true },
  });
  if (!poll) throw new Error("Poll not created for trip");
  return { tripId: trip.id as string, pollId: poll.id as string, poll };
}

/** Directly insert a trip_members row. Poll participants must be trip members first
 * (server-side permission check in polls.ts). */
async function addTripMember(
  tripId: string,
  userId: string,
  role: "owner" | "editor" | "viewer" = "editor",
) {
  await getTestDb().insert(tripMembers).values({ tripId, userId, role });
}

describe("Polls Integration", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));
  });

  afterAll(async () => {
    await cleanupTables();
  });

  // --- CRUD ---

  it("creates a poll via trip creation with options and auto-adds owner as participant", async () => {
    const { poll } = await createTripWithPoll(app);

    expect(poll.status).toBe("open");
    expect(poll.options).toHaveLength(2);
    expect(poll.options[0].startDate).toBe("2025-07-01");
    expect(poll.participants).toHaveLength(1);
    expect(poll.participants[0].userId).toBe(owner.id);
  });

  it("lists polls owned by user", async () => {
    await createTripWithPoll(app);

    const res = await app.request("/api/polls");
    expect(res.status).toBe(200);
    const polls = await res.json();
    expect(polls).toHaveLength(1);
    expect(polls[0].title).toBe("Summer Trip");
    expect(polls[0].participantCount).toBe(1);
    expect(polls[0].respondedCount).toBe(0);
  });

  it("lists polls where user is a participant", async () => {
    const other = await createTestUser({ name: "Other", email: "other@test.com" });
    const { tripId, pollId } = await createTripWithPoll(app);

    // Poll participants must already be trip members (permission check in polls.ts)
    await addTripMember(tripId, other.id);
    await app.request(`/api/polls/${pollId}/participants`, json({ userId: other.id }));

    // Switch to other user
    mockGetSession.mockImplementation(() => ({
      user: other,
      session: { id: "other-session" },
    }));

    const res = await app.request("/api/polls");
    expect(res.status).toBe(200);
    const polls = await res.json();
    expect(polls).toHaveLength(1);
    expect(polls[0].id).toBe(pollId);
  });

  it("gets poll detail with options and participants", async () => {
    const { pollId } = await createTripWithPoll(app);

    const res = await app.request(`/api/polls/${pollId}`);
    expect(res.status).toBe(200);
    const poll = await res.json();
    expect(poll.title).toBe("Summer Trip");
    expect(poll.isOwner).toBe(true);
    expect(poll.options).toHaveLength(2);
    expect(poll.participants).toHaveLength(1);
    expect(poll.myParticipantId).toBeTruthy();
  });

  it("assigns a non-colliding sortOrder to an option added after deleting a middle option", async () => {
    // Arrange: options A/B/C get sortOrder 0/1/2; deleting B leaves a gap
    const { pollId, poll } = await createTripWithPoll(app, {
      pollOptions: [
        { startDate: "2025-07-01", endDate: "2025-07-03" },
        { startDate: "2025-07-10", endDate: "2025-07-12" },
        { startDate: "2025-07-20", endDate: "2025-07-22" },
      ],
    });
    const middle = poll.options[1];
    await app.request(`/api/polls/${pollId}/options/${middle.id}`, { method: "DELETE" });

    // Act
    const res = await app.request(
      `/api/polls/${pollId}/options`,
      json({ startDate: "2025-08-01", endDate: "2025-08-03" }),
    );
    const option = await res.json();

    // Assert: MAX+1, not COUNT (COUNT=2 would collide with option C's sortOrder)
    expect(res.status).toBe(201);
    expect(option.sortOrder).toBe(3);
  });

  it("updates poll note", async () => {
    const { pollId } = await createTripWithPoll(app);

    const res = await app.request(`/api/polls/${pollId}`, patch({ note: "Updated note" }));
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.note).toBe("Updated note");
  });

  it("rejects update on non-open poll", async () => {
    const { pollId } = await createTripWithPoll(app);

    // Close poll directly in DB
    const db = getTestDb();
    await db.update(schedulePolls).set({ status: "closed" }).where(eq(schedulePolls.id, pollId));

    const res = await app.request(`/api/polls/${pollId}`, patch({ note: "Hacked" }));
    expect(res.status).toBe(400);
  });

  it("deletes a poll", async () => {
    const { pollId } = await createTripWithPoll(app);

    const res = await app.request(`/api/polls/${pollId}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const db = getTestDb();
    const poll = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.id, pollId),
    });
    expect(poll).toBeUndefined();
  });

  it("non-owner cannot update poll", async () => {
    const { pollId } = await createTripWithPoll(app);

    const other = await createTestUser({ name: "Other", email: "other@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: other,
      session: { id: "other-session" },
    }));

    const res = await app.request(`/api/polls/${pollId}`, patch({ note: "Hacked" }));
    expect(res.status).toBe(404);
  });

  it("non-participant cannot view poll", async () => {
    const { pollId } = await createTripWithPoll(app);

    const stranger = await createTestUser({ name: "Stranger", email: "stranger@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: stranger,
      session: { id: "stranger-session" },
    }));

    const res = await app.request(`/api/polls/${pollId}`);
    expect(res.status).toBe(404);
  });

  // --- Options ---

  it("adds an option to a poll", async () => {
    const { pollId } = await createTripWithPoll(app);

    const res = await app.request(
      `/api/polls/${pollId}/options`,
      json({ startDate: "2025-08-01", endDate: "2025-08-03" }),
    );
    expect(res.status).toBe(201);
    const option = await res.json();
    expect(option.startDate).toBe("2025-08-01");
    expect(option.sortOrder).toBe(2);
  });

  it("deletes an option from a poll", async () => {
    const { pollId, poll } = await createTripWithPoll(app);
    const optionId = poll.options[0].id;

    const res = await app.request(`/api/polls/${pollId}/options/${optionId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const db = getTestDb();
    const options = await db.query.schedulePollOptions.findMany({
      where: eq(schedulePollOptions.pollId, pollId),
    });
    expect(options).toHaveLength(1);
  });

  // --- Participants ---

  it("adds a participant to a poll", async () => {
    const { tripId, pollId } = await createTripWithPoll(app);

    const other = await createTestUser({ name: "Participant", email: "participant@test.com" });
    await addTripMember(tripId, other.id);
    const res = await app.request(`/api/polls/${pollId}/participants`, json({ userId: other.id }));
    expect(res.status).toBe(201);
    const participant = await res.json();
    expect(participant.userId).toBe(other.id);
    expect(participant.name).toBe("Participant");
  });

  it("rejects duplicate participant", async () => {
    const { tripId, pollId } = await createTripWithPoll(app);

    const other = await createTestUser({ name: "Dup", email: "dup@test.com" });
    await addTripMember(tripId, other.id);
    await app.request(`/api/polls/${pollId}/participants`, json({ userId: other.id }));

    const res = await app.request(`/api/polls/${pollId}/participants`, json({ userId: other.id }));
    expect(res.status).toBe(409);
  });

  it("removes a participant from a poll", async () => {
    const { tripId, pollId } = await createTripWithPoll(app);

    const other = await createTestUser({ name: "Remove", email: "remove@test.com" });
    await addTripMember(tripId, other.id);
    const addRes = await app.request(
      `/api/polls/${pollId}/participants`,
      json({ userId: other.id }),
    );
    const participant = await addRes.json();

    const res = await app.request(`/api/polls/${pollId}/participants/${participant.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const db = getTestDb();
    const participants = await db.query.schedulePollParticipants.findMany({
      where: eq(schedulePollParticipants.pollId, pollId),
    });
    // Only owner remains
    expect(participants).toHaveLength(1);
  });

  // --- Responses ---

  it("submits responses for a participant", async () => {
    const { pollId, poll } = await createTripWithPoll(app);

    const res = await app.request(
      `/api/polls/${pollId}/responses`,
      put({
        responses: [
          { optionId: poll.options[0].id, response: "ok" },
          { optionId: poll.options[1].id, response: "ng" },
        ],
      }),
    );
    expect(res.status).toBe(200);

    const db = getTestDb();
    const responses = await db.query.schedulePollResponses.findMany({
      where: eq(schedulePollResponses.participantId, poll.participants[0].id),
    });
    expect(responses).toHaveLength(2);
  });

  it("replaces existing responses on resubmit", async () => {
    const { pollId, poll } = await createTripWithPoll(app);

    // First submission
    await app.request(
      `/api/polls/${pollId}/responses`,
      put({
        responses: [
          { optionId: poll.options[0].id, response: "ok" },
          { optionId: poll.options[1].id, response: "ng" },
        ],
      }),
    );

    // Second submission (replace)
    await app.request(
      `/api/polls/${pollId}/responses`,
      put({
        responses: [{ optionId: poll.options[0].id, response: "maybe" }],
      }),
    );

    const db = getTestDb();
    const responses = await db.query.schedulePollResponses.findMany({
      where: eq(schedulePollResponses.participantId, poll.participants[0].id),
    });
    expect(responses).toHaveLength(1);
    expect(responses[0].response).toBe("maybe");
  });

  it("rejects responses from non-participant", async () => {
    const { pollId, poll } = await createTripWithPoll(app);

    const stranger = await createTestUser({ name: "Stranger", email: "stranger@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: stranger,
      session: { id: "stranger-session" },
    }));

    const res = await app.request(
      `/api/polls/${pollId}/responses`,
      put({ responses: [{ optionId: poll.options[0].id, response: "ok" }] }),
    );
    expect(res.status).toBe(404);
  });

  // --- Share ---

  it("generates a share token", async () => {
    const { pollId } = await createTripWithPoll(app);

    const res = await app.request(`/api/polls/${pollId}/share`, json({}));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shareToken).toBeTruthy();
    // randomBytes(32).toString("base64url") → 43 chars (see lib/share-token.ts)
    expect(data.shareToken).toHaveLength(43);
  });

  it("returns existing share token on repeated call", async () => {
    const { pollId } = await createTripWithPoll(app);

    const res1 = await app.request(`/api/polls/${pollId}/share`, json({}));
    const data1 = await res1.json();

    const res2 = await app.request(`/api/polls/${pollId}/share`, json({}));
    const data2 = await res2.json();

    expect(data1.shareToken).toBe(data2.shareToken);
  });

  // --- Shared poll (no auth) ---

  it("views shared poll via token", async () => {
    const { pollId } = await createTripWithPoll(app);

    const shareRes = await app.request(`/api/polls/${pollId}/share`, json({}));
    const { shareToken } = await shareRes.json();

    const res = await app.request(`/api/shared/polls/${shareToken}`);
    expect(res.status).toBe(200);
    const poll = await res.json();
    expect(poll.title).toBe("Summer Trip");
    expect(poll.options).toHaveLength(2);
    expect(poll.participants).toHaveLength(1);
  });

  it("returns 404 for invalid share token", async () => {
    const res = await app.request("/api/shared/polls/invalid-token");
    expect(res.status).toBe(404);
  });

  // --- Confirm ---

  it("confirms a poll and updates the trip", async () => {
    const { pollId, poll, tripId } = await createTripWithPoll(app);

    // Add another participant (must be trip member first)
    const other = await createTestUser({ name: "Member", email: "member@test.com" });
    await addTripMember(tripId, other.id);
    await app.request(`/api/polls/${pollId}/participants`, json({ userId: other.id }));

    const res = await app.request(
      `/api/polls/${pollId}/confirm`,
      json({ optionId: poll.options[0].id }),
    );
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.status).toBe("confirmed");
    expect(result.tripId).toBe(tripId);
    expect(result.confirmedOptionId).toBe(poll.options[0].id);

    const db = getTestDb();

    // Trip was updated with dates
    const days = await db.query.tripDays.findMany({
      where: eq(tripDays.tripId, tripId),
    });
    // 2025-07-01 to 2025-07-03 = 3 days
    expect(days).toHaveLength(3);

    // Members were added
    const members = await db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
    });
    expect(members).toHaveLength(2);
    const ownerMember = members.find((m) => m.userId === owner.id);
    expect(ownerMember?.role).toBe("owner");
    const otherMember = members.find((m) => m.userId === other.id);
    expect(otherMember?.role).toBe("editor");
  });

  it("rejects confirm on non-open poll", async () => {
    const { pollId, poll } = await createTripWithPoll(app);

    // Confirm first
    await app.request(`/api/polls/${pollId}/confirm`, json({ optionId: poll.options[0].id }));

    // Try to confirm again
    const res = await app.request(
      `/api/polls/${pollId}/confirm`,
      json({ optionId: poll.options[1].id }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Trip creation with poll mode", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));
  });

  afterAll(async () => {
    await cleanupTables();
  });

  it("creates a trip with scheduling status when pollOptions provided", async () => {
    const res = await app.request(
      "/api/trips",
      json({
        title: "Summer Trip",
        destination: "Okinawa",
        pollOptions: [
          { startDate: "2026-08-01", endDate: "2026-08-03" },
          { startDate: "2026-08-08", endDate: "2026-08-10" },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const trip = await res.json();
    expect(trip.status).toBe("scheduling");
    expect(trip.startDate).toBeNull();
    expect(trip.endDate).toBeNull();
  });

  it("does not create trip_days when status is scheduling", async () => {
    const res = await app.request(
      "/api/trips",
      json({
        title: "No Days Trip",
        destination: "Tokyo",
        pollOptions: [{ startDate: "2026-09-01", endDate: "2026-09-02" }],
      }),
    );
    const trip = await res.json();

    const db = getTestDb();
    const days = await db.query.tripDays.findMany({
      where: eq(tripDays.tripId, trip.id),
    });
    expect(days).toHaveLength(0);
  });

  it("creates a linked poll with owner as participant", async () => {
    const res = await app.request(
      "/api/trips",
      json({
        title: "Poll Trip",
        destination: "Kyoto",
        pollOptions: [
          { startDate: "2026-10-01", endDate: "2026-10-03" },
          { startDate: "2026-10-15", endDate: "2026-10-17" },
        ],
      }),
    );
    const trip = await res.json();

    const db = getTestDb();
    const poll = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.tripId, trip.id),
      with: { options: true, participants: true },
    });

    expect(poll).toBeTruthy();
    expect(poll?.status).toBe("open");
    expect(poll?.options).toHaveLength(2);
    expect(poll?.participants).toHaveLength(1);
    expect(poll?.participants[0].userId).toBe(owner.id);
  });

  it("still creates a normal draft trip with startDate/endDate", async () => {
    const res = await app.request(
      "/api/trips",
      json({
        title: "Direct Trip",
        destination: "Nara",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      }),
    );

    expect(res.status).toBe(201);
    const trip = await res.json();
    expect(trip.status).toBe("draft");

    const db = getTestDb();
    const days = await db.query.tripDays.findMany({
      where: eq(tripDays.tripId, trip.id),
    });
    expect(days.length).toBeGreaterThan(0);
  });
});

describe("Poll confirm with existing trip", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));
  });

  afterAll(async () => {
    await cleanupTables();
  });

  it("updates existing trip dates and status on confirm", async () => {
    const createRes = await app.request(
      "/api/trips",
      json({
        title: "Confirm Trip",
        destination: "Osaka",
        pollOptions: [
          { startDate: "2026-08-01", endDate: "2026-08-03" },
          { startDate: "2026-09-10", endDate: "2026-09-12" },
        ],
      }),
    );
    const trip = await createRes.json();
    expect(trip.status).toBe("scheduling");

    const db = getTestDb();
    const poll = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.tripId, trip.id),
      with: { options: true },
    });
    if (!poll) throw new Error("Poll not found");

    // Confirm with second option
    const confirmRes = await app.request(
      `/api/polls/${poll.id}/confirm`,
      json({ optionId: poll.options[1].id }),
    );
    expect(confirmRes.status).toBe(200);

    // Verify trip was updated (not a new trip created)
    const updatedTrip = await db.query.trips.findFirst({
      where: eq(trips.id, trip.id),
    });
    expect(updatedTrip?.status).toBe("draft");
    expect(updatedTrip?.startDate).toBe("2026-09-10");
    expect(updatedTrip?.endDate).toBe("2026-09-12");

    // Verify trip_days were created
    const days = await db.query.tripDays.findMany({
      where: eq(tripDays.tripId, trip.id),
    });
    expect(days).toHaveLength(3);
  });

  it("adds poll participants as trip members on confirm", async () => {
    const other = await createTestUser({ name: "Participant", email: "part@test.com" });

    const createRes = await app.request(
      "/api/trips",
      json({
        title: "Member Trip",
        destination: "Tokyo",
        pollOptions: [{ startDate: "2026-11-01", endDate: "2026-11-02" }],
      }),
    );
    const trip = await createRes.json();

    const db = getTestDb();
    const poll = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.tripId, trip.id),
      with: { options: true },
    });
    if (!poll) throw new Error("Poll not found");

    // Add participant to poll
    await db.insert(schedulePollParticipants).values({
      pollId: poll.id,
      userId: other.id,
    });

    // Confirm
    const confirmRes = await app.request(
      `/api/polls/${poll.id}/confirm`,
      json({ optionId: poll.options[0].id }),
    );
    expect(confirmRes.status).toBe(200);

    // Verify members
    const members = await db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, trip.id),
    });
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.userId === other.id)?.role).toBe("editor");
  });
});

describe("Trip detail with poll data", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));
  });

  afterAll(async () => {
    await cleanupTables();
  });

  it("includes poll summary when trip has a linked poll", async () => {
    const createRes = await app.request(
      "/api/trips",
      json({
        title: "Poll Detail Trip",
        destination: "Hokkaido",
        pollOptions: [{ startDate: "2026-12-01", endDate: "2026-12-03" }],
      }),
    );
    const trip = await createRes.json();

    const detailRes = await app.request(`/api/trips/${trip.id}`);
    const detail = await detailRes.json();

    expect(detail.poll).toBeTruthy();
    expect(detail.poll.status).toBe("open");
    expect(detail.poll.participantCount).toBe(1);
    expect(detail.poll.respondedCount).toBe(0);
  });

  it("has poll: null when no linked poll", async () => {
    const createRes = await app.request(
      "/api/trips",
      json({
        title: "No Poll Trip",
        destination: "Nagoya",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      }),
    );
    const trip = await createRes.json();

    const detailRes = await app.request(`/api/trips/${trip.id}`);
    const detail = await detailRes.json();

    expect(detail.poll).toBeNull();
  });
});

// --- Delete poll cascades to scheduling trip ---

describe("Delete poll cascade", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  it("deletes scheduling trip when poll is deleted", async () => {
    const createRes = await app.request(
      "/api/trips",
      json({
        title: "Delete Cascade",
        destination: "Tokyo",
        pollOptions: [{ startDate: "2026-08-01", endDate: "2026-08-02" }],
      }),
    );
    const trip = await createRes.json();
    expect(trip.status).toBe("scheduling");

    const db = getTestDb();
    const poll = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.tripId, trip.id),
    });
    if (!poll) throw new Error("Poll not found");

    const deleteRes = await app.request(`/api/polls/${poll.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const deletedTrip = await db.query.trips.findFirst({
      where: eq(trips.id, trip.id),
    });
    expect(deletedTrip).toBeUndefined();
  });

  it("does NOT delete trip when poll is deleted after confirmation", async () => {
    const createRes = await app.request(
      "/api/trips",
      json({
        title: "Confirmed Trip",
        destination: "Osaka",
        pollOptions: [{ startDate: "2026-09-01", endDate: "2026-09-02" }],
      }),
    );
    const trip = await createRes.json();

    const db = getTestDb();
    const poll = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.tripId, trip.id),
      with: { options: true },
    });
    if (!poll) throw new Error("Poll not found");

    // Confirm the poll first
    await app.request(`/api/polls/${poll.id}/confirm`, json({ optionId: poll.options[0].id }));

    // Now delete the poll
    const deleteRes = await app.request(`/api/polls/${poll.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    // Trip should still exist (now in draft status)
    const existingTrip = await db.query.trips.findFirst({
      where: eq(trips.id, trip.id),
    });
    expect(existingTrip).toBeTruthy();
    expect(existingTrip?.status).toBe("draft");
  });
});
