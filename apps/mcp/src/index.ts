import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "./client.js";
import { parseEnv } from "./env.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // Validate environment before doing anything else.
  // parseEnv writes to stderr and exits on failure — stdout is never touched.
  const env = parseEnv();

  const client = new ApiClient(env.baseUrl, env.apiKey);

  const server = new McpServer({
    name: "sugara-mcp",
    version: "1.0.0",
  });

  registerTools(server, client);

  // StdioServerTransport reads from stdin and writes to stdout.
  // All logging must use stderr to avoid corrupting the JSON-RPC channel.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("[sugara-mcp] Server started. Listening on stdio.\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[sugara-mcp] Fatal error: ${message}\n`);
  process.exit(1);
});
