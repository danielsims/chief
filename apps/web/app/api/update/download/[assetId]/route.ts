import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getReleaseAssetDownloadUrl } from "../../../../../lib/github-releases";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  if (!/^\d+$/.test(assetId)) {
    return NextResponse.json({ error: "Invalid asset" }, { status: 400 });
  }

  const location = await getReleaseAssetDownloadUrl(Number(assetId));

  if (!location) {
    return NextResponse.json(
      { error: "Update download is unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.redirect(location);
}
