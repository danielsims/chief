/**
 * Desktop Session Proxy
 *
 * The desktop app stores a raw session token (from BetterAuth's get-session
 * response). To re-validate, it sends the token as a Bearer header.
 *
 * This route proxies the request to BetterAuth's /api/auth/get-session,
 * forwarding the Authorization header. The `bearer` plugin on the server
 * converts the Bearer token to a signed session cookie internally.
 *
 * Desktop app calls:
 *   GET /api/desktop-auth/session
 *   Authorization: Bearer {raw_session_token}
 *
 * This route proxies to:
 *   GET /api/auth/get-session (via Next.js catch-all → Convex site)
 *   Authorization: Bearer {raw_session_token}
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { desktopCorsHeaders } from "../../../../lib/desktop-auth";

export function OPTIONS(request: NextRequest) {
  const cors = desktopCorsHeaders(request.headers.get("origin"));
  if (!cors["Access-Control-Allow-Origin"]) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const cors = desktopCorsHeaders(origin);

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401, headers: cors },
    );
  }

  const url = new URL(request.url);
  const baseUrl = url.origin;

  try {
    // Forward the Bearer token to BetterAuth's get-session via the Next.js
    // proxy. The bearer plugin on the Convex side will convert it to a
    // signed session cookie internally.
    const response = await fetch(`${baseUrl}/api/auth/get-session`, {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Session invalid or expired" },
        { status: 401, headers: cors },
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(data, { headers: cors });
  } catch {
    return NextResponse.json(
      { error: "Failed to validate session" },
      { status: 502, headers: cors },
    );
  }
}
