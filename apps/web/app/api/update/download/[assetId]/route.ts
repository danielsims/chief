import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "../../../../../lib/env";

const GITHUB_TOKEN = env.GITHUB_TOKEN;
const REPOSITORY = "danielsims/chief";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  if (!/^\d+$/.test(assetId)) {
    return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
  }

  const assetResponse = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/assets/${assetId}`,
    {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "Chief update service",
        ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
      },
      redirect: "manual",
      cache: "no-store",
    },
  );
  const location = assetResponse.headers.get("location");

  if (!location) {
    return NextResponse.json(
      { error: "Update download is unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.redirect(location);
}
