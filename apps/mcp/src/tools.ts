import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiClient } from "./client.js";

// Exported raw shapes for testing (input schema validation can be checked against these)
// Note: z.string().uuid() validates strict UUID v4 format, which is stricter than the
// v1 API's guid() validator (which also accepts v1-v5). All IDs are v4-generated in
// practice, so this extra strictness causes no real-world rejections.
export const INPUT_SHAPES = {
  list_trips: {
    scope: z.enum(["owned", "shared"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  get_trip: {
    id: z.string().uuid(),
  },
  list_trip_expenses: {
    tripId: z.string().uuid(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  list_bookmark_lists: {
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  list_bookmarks: {
    listId: z.string().uuid(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  list_articles: {
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  },
  get_article: {
    id: z.string().uuid(),
  },
} as const;

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Registers all 7 sugara v1 read-only tools with the MCP server.
 * Each tool maps 1:1 to a v1 endpoint and returns the raw JSON response.
 * On client errors, returns an isError result with a human-readable message.
 */
export function registerTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "list_trips",
    {
      description:
        "List trips the API key owner is a member of. " +
        "Scope 'owned' returns trips where the owner role is held; " +
        "'shared' returns trips shared by others. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_trips,
    },
    async (args) => {
      try {
        const result = await client.listTrips(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "get_trip",
    {
      description:
        "Get full details of a trip by its UUID. " +
        "Returns members with memberNo (a sequential number within the trip, not a database ID) " +
        "and days with scheduled spots.",
      inputSchema: INPUT_SHAPES.get_trip,
    },
    async (args) => {
      try {
        const result = await client.getTrip(args.id);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_trip_expenses",
    {
      description:
        "List expenses for a trip. " +
        "paidBy and splits reference members by memberNo " +
        "(a sequential number within the trip, consistent with get_trip member list). " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_trip_expenses,
    },
    async (args) => {
      try {
        const result = await client.listTripExpenses(args.tripId, {
          limit: args.limit,
          offset: args.offset,
        });
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_bookmark_lists",
    {
      description:
        "List the bookmark lists owned by the API key holder. " +
        "Each list includes a bookmarkCount. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_bookmark_lists,
    },
    async (args) => {
      try {
        const result = await client.listBookmarkLists(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_bookmarks",
    {
      description:
        "List bookmarks inside a specific bookmark list. " +
        "Only lists owned by the API key holder are accessible. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_bookmarks,
    },
    async (args) => {
      try {
        const result = await client.listBookmarks(args.listId, {
          limit: args.limit,
          offset: args.offset,
        });
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "list_articles",
    {
      description:
        "List articles owned by the API key holder (without content body). " +
        "Use get_article to fetch the full content of a specific article. " +
        "Supports limit/offset pagination.",
      inputSchema: INPUT_SHAPES.list_articles,
    },
    async (args) => {
      try {
        const result = await client.listArticles(args);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );

  server.registerTool(
    "get_article",
    {
      description:
        "Get the full content of an article by its UUID. " +
        "Only articles owned by the API key holder are accessible.",
      inputSchema: INPUT_SHAPES.get_article,
    },
    async (args) => {
      try {
        const result = await client.getArticle(args.id);
        return toolResult(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : "Unexpected error");
      }
    },
  );
}
