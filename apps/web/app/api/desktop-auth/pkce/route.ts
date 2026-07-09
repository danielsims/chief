import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { desktopCorsHeaders } from "../../../../lib/desktop-auth";
import {
  getPendingDesktopPkce,
  storePendingDesktopPkce,
} from "../../../../lib/desktop-pkce-store";

export function OPTIONS(request: NextRequest) {
  const cors = desktopCorsHeaders(request.headers.get("origin"));
  if (!cors["Access-Control-Allow-Origin"]) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: cors });
}

export function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const cors = desktopCorsHeaders(origin);

  const state = request.nextUrl.searchParams.get("state");
  if (!state) {
    return NextResponse.json(
      { error: "Missing state" },
      { status: 400, headers: cors },
    );
  }

  try {
    const redirectToken = getPendingDesktopPkce(state);

    if (!redirectToken) {
      return NextResponse.json(
        { status: "pending" },
        { status: 202, headers: cors },
      );
    }

    return NextResponse.json(
      { status: "complete", redirectToken },
      { headers: cors },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to check desktop PKCE status" },
      { status: 502, headers: cors },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      state?: string;
      redirectToken?: string;
    };

    if (!body.state || !body.redirectToken) {
      return NextResponse.json(
        { error: "Missing state or redirectToken" },
        { status: 400 },
      );
    }

    storePendingDesktopPkce(body.state, body.redirectToken);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to store desktop PKCE status" },
      { status: 502 },
    );
  }
}
