import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient, type ListTripsOptions, type PaginationOptions } from "../client.js";
import { registerTools } from "../tools.js";

// --- Type guard helpers ---

// callTool returns a union type where both branches have [x: string]: unknown, so
// "content" in result does not narrow reliably in TypeScript. Use explicit runtime
// guards instead.

type ContentCallResult = {
  content: unknown[];
  isError?: boolean;
};

type TextContentItem = { type: "text"; text: string };

function isContentCallResult(value: unknown): value is ContentCallResult {
  if (typeof value !== "object" || value === null) return false;
  // Safe: we explicitly check the runtime type before relying on the cast
  return Array.isArray((value as Record<string, unknown>).content);
}

function isTextContentItem(item: unknown): item is TextContentItem {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return candidate.type === "text" && typeof candidate.text === "string";
}

// --- Fixtures ---

// Fixed data returned by FakeApiClient.listTrips — used to assert the tool
// correctly serialises the client response into content[0].text.
const FAKE_TRIPS = {
  data: [{ id: "00000000-0000-0000-0000-000000000001" }],
  pagination: { total: 1 },
};

// The 7 tool names that registerTools must expose.
const EXPECTED_TOOL_NAMES = [
  "list_trips",
  "get_trip",
  "list_trip_expenses",
  "list_bookmark_lists",
  "list_bookmarks",
  "list_articles",
  "get_article",
] as const;

/**
 * Fake ApiClient that returns fixed in-memory data.
 * Overrides every public method so no network calls are made.
 */
class FakeApiClient extends ApiClient {
  constructor() {
    // baseUrl / apiKey / fetchFn are never used by the overridden methods
    super("http://localhost", "test_key");
  }

  override async listTrips(_opts?: ListTripsOptions): Promise<unknown> {
    return FAKE_TRIPS;
  }

  override async getTrip(_id: string): Promise<unknown> {
    return { id: "00000000-0000-0000-0000-000000000001", title: "Test Trip", days: [] };
  }

  override async listTripExpenses(_tripId: string, _opts?: PaginationOptions): Promise<unknown> {
    return { data: [], pagination: { total: 0 } };
  }

  override async listBookmarkLists(_opts?: PaginationOptions): Promise<unknown> {
    return { data: [], pagination: { total: 0 } };
  }

  override async listBookmarks(_listId: string, _opts?: PaginationOptions): Promise<unknown> {
    return { data: [], pagination: { total: 0 } };
  }

  override async listArticles(_opts?: PaginationOptions): Promise<unknown> {
    return { data: [], pagination: { total: 0 } };
  }

  override async getArticle(_id: string): Promise<unknown> {
    return { id: "00000000-0000-0000-0000-000000000001", title: "Test", content: "" };
  }
}

/**
 * Fake ApiClient where listTrips always throws — used to verify isError handling.
 */
class ThrowingApiClient extends ApiClient {
  constructor() {
    super("http://localhost", "test_key");
  }

  override async listTrips(_opts?: ListTripsOptions): Promise<unknown> {
    throw new Error("API unavailable");
  }
}

/**
 * Connects an McpServer to an MCP Client through an InMemoryTransport pair.
 * Returns both ends so tests can drive the client and tear down after.
 */
async function setupPair(apiClient: ApiClient): Promise<{ server: McpServer; client: Client }> {
  const server = new McpServer({ name: "sugara-mcp", version: "0.0.0" });
  registerTools(server, apiClient);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  return { server, client };
}

// --- Tests ---

describe("MCP server — tools/list", () => {
  let mcpServer!: McpServer;
  let mcpClient!: Client;

  beforeEach(async () => {
    const pair = await setupPair(new FakeApiClient());
    mcpServer = pair.server;
    mcpClient = pair.client;
  });

  afterEach(async () => {
    await mcpClient.close();
    await mcpServer.close();
  });

  it("returns exactly 7 tools", async () => {
    // Arrange + Act
    const result = await mcpClient.listTools();

    // Assert
    expect(result.tools).toHaveLength(7);
  });

  it("includes all 7 expected tool names", async () => {
    // Arrange + Act
    const result = await mcpClient.listTools();
    const names = result.tools.map((t) => t.name);

    // Assert
    expect(names).toEqual(expect.arrayContaining([...EXPECTED_TOOL_NAMES]));
  });
});

describe("MCP server — tools/call list_trips (success path)", () => {
  let mcpServer!: McpServer;
  let mcpClient!: Client;

  beforeEach(async () => {
    const pair = await setupPair(new FakeApiClient());
    mcpServer = pair.server;
    mcpClient = pair.client;
  });

  afterEach(async () => {
    await mcpClient.close();
    await mcpServer.close();
  });

  it("returns fake client data as JSON string in content[0].text", async () => {
    // Arrange + Act
    const result = await mcpClient.callTool({ name: "list_trips", arguments: {} });

    // Assert — use type guards because the union's [x: string]: unknown prevents in-narrowing
    if (!isContentCallResult(result)) throw new Error("expected content-bearing result");
    const first = result.content[0];
    if (!isTextContentItem(first)) throw new Error("expected text content item");
    expect(JSON.parse(first.text)).toEqual(FAKE_TRIPS);
  });
});

describe("MCP server — tools/call list_trips (error path)", () => {
  let mcpServer!: McpServer;
  let mcpClient!: Client;

  beforeEach(async () => {
    const pair = await setupPair(new ThrowingApiClient());
    mcpServer = pair.server;
    mcpClient = pair.client;
  });

  afterEach(async () => {
    await mcpClient.close();
    await mcpServer.close();
  });

  it("returns isError: true when the API client throws", async () => {
    // Arrange + Act
    const result = await mcpClient.callTool({ name: "list_trips", arguments: {} });

    // Assert
    if (!isContentCallResult(result)) throw new Error("expected content-bearing result");
    expect(result.isError).toBe(true);
  });
});
