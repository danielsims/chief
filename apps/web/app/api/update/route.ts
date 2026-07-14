import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  getLatestRelease,
  getReleaseAssetDownloadUrl,
} from "../../../lib/github-releases";

const PLATFORM_ASSETS: Record<string, { asset: RegExp; signature: RegExp }> = {
  "darwin-universal": {
    asset: /Chief.*\.app\.tar\.gz$/,
    signature: /Chief.*\.app\.tar\.gz\.sig$/,
  },
  "darwin-aarch64": {
    asset: /Chief.*\.app\.tar\.gz$/,
    signature: /Chief.*\.app\.tar\.gz\.sig$/,
  },
  "darwin-x86_64": {
    asset: /Chief.*\.app\.tar\.gz$/,
    signature: /Chief.*\.app\.tar\.gz\.sig$/,
  },
  "linux-x86_64": {
    asset: /Chief.*_amd64\.AppImage\.tar\.gz$/,
    signature: /Chief.*_amd64\.AppImage\.tar\.gz\.sig$/,
  },
  "windows-x86_64": {
    asset: /Chief.*_x64-setup\.exe$/,
    signature: /Chief.*_x64-setup\.exe\.sig$/,
  },
};

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("target") ?? "";
  const arch = request.nextUrl.searchParams.get("arch") ?? "";
  const currentVersion =
    request.nextUrl.searchParams.get("current_version") ?? "";
  const patterns = PLATFORM_ASSETS[`${target}-${arch}`];

  if (!patterns) return new NextResponse(null, { status: 204 });

  const release = await getLatestRelease();
  if (!release) return new NextResponse(null, { status: 204 });
  const version = release.tag_name.replace(/^v/, "");
  if (version === currentVersion) {
    return new NextResponse(null, { status: 204 });
  }

  const asset = release.assets.find(({ name }) => patterns.asset.test(name));
  const signatureAsset = release.assets.find(({ name }) =>
    patterns.signature.test(name),
  );
  if (!asset || !signatureAsset) {
    return new NextResponse(null, { status: 204 });
  }

  const signatureUrl = await getReleaseAssetDownloadUrl(signatureAsset.id);
  if (!signatureUrl) {
    return new NextResponse(null, { status: 204 });
  }
  const signatureResponse = await fetch(signatureUrl, { cache: "no-store" });
  if (!signatureResponse.ok) return new NextResponse(null, { status: 204 });

  const downloadUrl = new URL(
    `/api/update/download/${asset.id}`,
    request.nextUrl.origin,
  ).toString();

  return NextResponse.json({
    version,
    notes: release.body ?? "",
    pub_date: release.published_at,
    url: downloadUrl,
    signature: (await signatureResponse.text()).trim(),
  });
}
