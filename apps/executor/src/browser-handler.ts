import type { ExecutionLease } from "@chief/relay-contracts";
import {
  browserFillRequestSchema,
  browserOpenRequestSchema,
  browserSelectRequestSchema,
  browserTargetSchema,
} from "@chief/relay-contracts";

import type { BrowserRegistry } from "./browser-registry";
import { requireCapability } from "./auth";

export async function routeBrowserRequest(
  request: Request,
  url: URL,
  lease: ExecutionLease,
  browsers: BrowserRegistry,
) {
  if (!url.pathname.startsWith("/v1/browser/")) return undefined;
  requireCapability(lease, "browser:use");
  if (request.method === "POST" && url.pathname === "/v1/browser/open") {
    const input = browserOpenRequestSchema.parse(await request.json());
    return json(await browsers.open(lease, input.url, input.fresh));
  }
  if (request.method === "POST" && url.pathname === "/v1/browser/snapshot") {
    return json(await browsers.snapshot(lease));
  }
  if (request.method === "POST" && url.pathname === "/v1/browser/click") {
    const target = browserTargetSchema.parse(await request.json());
    return json(await browsers.click(lease, target));
  }
  if (request.method === "POST" && url.pathname === "/v1/browser/fill") {
    const input = browserFillRequestSchema.parse(await request.json());
    return json(await browsers.fill(lease, input.target, input.text));
  }
  if (request.method === "POST" && url.pathname === "/v1/browser/select") {
    const input = browserSelectRequestSchema.parse(await request.json());
    return json(await browsers.select(lease, input.target, input.values));
  }
  if (request.method === "POST" && url.pathname === "/v1/browser/screenshot") {
    const screenshot = await browsers.screenshot(lease);
    return new Response(screenshot, {
      headers: { "content-type": "image/png" },
    });
  }
  if (
    request.method === "POST" &&
    url.pathname === "/v1/browser/stream-ticket"
  ) {
    return json(await browsers.createStreamTicket(lease));
  }
  if (request.method === "POST" && url.pathname === "/v1/browser/close") {
    await browsers.close(lease);
    return json({ closed: true });
  }
  return undefined;
}

type BrowserResponse =
  | { url: string; title: string; text: string; controls: string[] }
  | { streamUrl: string; expiresAt: string }
  | { closed: boolean };

function json(value: BrowserResponse) {
  return Response.json(value);
}
