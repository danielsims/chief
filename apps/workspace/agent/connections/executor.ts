import { defineMcpClientConnection } from "eve/connections";

// The entire Executor seam: one URL, one bearer token. In the local dev loop
// this is the workspace daemon's /mcp endpoint; deployed it points at the
// tenant's hosted Executor. Swapping hosts never touches agent code.
export default defineMcpClientConnection({
  url: process.env.EXECUTOR_MCP_URL ?? "http://localhost:4788/mcp",
  description:
    "Connected marketing integrations and analytics for this Chief workspace.",
  auth: {
    getToken: async () => ({ token: process.env.EXECUTOR_MCP_TOKEN ?? "" }),
  },
});
