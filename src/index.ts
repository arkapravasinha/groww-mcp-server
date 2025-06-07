import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Optional: Define configuration schema to require configuration at connection time
export const configSchema = z.object({
  debug: z.boolean().default(false).describe("Enable debug logging"),
});

export default function createStatelessServer({
  config,
}: {
  config: z.infer<typeof configSchema>;
}) {
  const server = new McpServer({
    name: "My MCP Server",
    version: "1.0.0",
  });

  // Add a tool
  server.tool(
    "hello",
    "Say hello to someone",
    {
      name: z.string().describe("Name to greet"),
    },
    async ({ name }) => {
      return {
        content: [{ type: "text", text: `Hello, ${name}!` }],
      };
    }
  );

  return server.server;
}
