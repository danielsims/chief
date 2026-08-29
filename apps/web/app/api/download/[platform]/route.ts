import { NextResponse } from "next/server";

import {
  getLatestRelease,
  getReleaseAssetDownloadUrl,
} from "../../../../lib/github-releases";

const DOWNLOAD_ASSETS = {
  macos: /_aarch64\.dmg$/,
  windows: /_x64-setup\.exe$/,
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const assetPattern = Object.entries(DOWNLOAD_ASSETS).find(
    ([candidate]) => candidate === platform,
  )?.[1];
  if (!assetPattern) {
    return NextResponse.json(
      { error: "Unsupported platform" },
      { status: 404 },
    );
  }

  const release = await getLatestRelease();
  if (!release) {
    return NextResponse.json(
      { error: "The latest release is unavailable" },
      { status: 503 },
    );
  }

  const asset = release.assets.find(({ name }) => assetPattern.test(name));
  if (!asset) {
    return NextResponse.json(
      { error: `No ${platform} download is available for this release` },
      { status: 404 },
    );
  }

  const downloadUrl = await getReleaseAssetDownloadUrl(asset.id);
  if (!downloadUrl) {
    return NextResponse.json(
      { error: "The release download is temporarily unavailable" },
      { status: 502 },
    );
  }

  return NextResponse.redirect(downloadUrl);
}
