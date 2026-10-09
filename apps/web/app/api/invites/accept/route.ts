import { z } from "zod";

import { env } from "../../../../lib/env";
import { isWorkspaceId } from "../../../../lib/invitation-links";
import { isInviteSecret } from "../../../../lib/invite-link-server";

const acceptSchema = z.object({ workspace: z.string(), secret: z.string() });

/**
 * Accepts an invite link for the signed-in visitor. The relay is the auth
 * server: this forwards the first-party session cookie and lets the relay
 * resolve the account, consume the link, and add the membership.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: { code: "forbidden" } }, { status: 403 });
  }
  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success ||
    !isWorkspaceId(parsed.data.workspace) ||
    !isInviteSecret(parsed.data.secret)
  ) {
    return Response.json(
      { error: { code: "invalid_request" } },
      { status: 400 },
    );
  }
  const headers = new Headers({ "content-type": "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const source = new URL(request.url);
  headers.set("x-forwarded-host", source.host);
  headers.set("x-forwarded-proto", source.protocol.replace(":", ""));
  const response = await fetch(
    new URL(
      `/v1/workspaces/${encodeURIComponent(parsed.data.workspace)}/invites/accept`,
      env.CHIEF_RELAY_URL,
    ),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        secret: parsed.data.secret,
      }),
      cache: "no-store",
    },
  );
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
