import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const UPSTREAM = "http://127.0.0.1:3845/mcp"; // tu Figma MCP

function flattenToolResult(result) {
  const parts = [];
  if (result?.content && Array.isArray(result.content)) {
    for (const c of result.content) {
      if (!c) continue;
      if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (typeof c === "string") parts.push(c);
      else parts.push(JSON.stringify(c));
    }
  } else if (typeof result === "string") {
    parts.push(result);
  } else {
    parts.push(JSON.stringify(result));
  }
  return parts.join("\n\n---\n\n");
}

async function makeUpstreamClient() {
  const client = new Client(
    { name: "figma-mcp-proxy-upstream", version: "0.0.1" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(UPSTREAM));
  await client.connect(transport);
  return client;
}

async function main() {
  const upstream = await makeUpstreamClient();

  const server = new McpServer({ name: "figma-mcp-proxy", version: "0.0.1" });

  const NodeIdSchema = z.object({
    nodeId: z.string().optional(),
    nodeid: z.string().optional(),
    url: z.string().optional(),
    clientLanguages: z.string().optional(),
    clientFrameworks: z.string().optional(),
  });

  async function proxyTool(toolName, args, { flatten = false } = {}) {
    const res = await upstream.callTool({ name: toolName, arguments: args });
    if (!flatten) return res;
    const text = flattenToolResult(res);

    // Devuelve 1 solo bloque => Cursor no puede “quedarse con el último”
    return { content: [{ type: "text", text }] };
  }

  server.tool(
    "get_design_context",
    "Proxy a Figma get_design_context, pero aplana la respuesta a un solo bloque.",
    NodeIdSchema,
    async (args) => proxyTool("get_design_context", args, { flatten: true }),
  );

  // passthrough útiles
  server.tool("get_screenshot", "Passthrough", NodeIdSchema, async (args) =>
    proxyTool("get_screenshot", args),
  );

  server.tool(
    "get_metadata",
    "Flattened passthrough",
    NodeIdSchema,
    async (args) => proxyTool("get_metadata", args, { flatten: true }),
  );

  server.tool(
    "get_variable_defs",
    "Flattened passthrough",
    NodeIdSchema,
    async (args) => proxyTool("get_variable_defs", args, { flatten: true }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log("Server started");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
