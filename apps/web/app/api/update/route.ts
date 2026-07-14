import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { env } from "../../../lib/env";

const GITHUB_TOKEN = env.GITHUB_TOKEN;
const REPOSITORY = "danielsims/chief";

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

interface GitHubAsset {
  id: number;
  name: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  assets: GitHubAsset[];
}

function githubHeaders(accept: string) {
  return {
    Accept: accept,
    "User-Agent": "Chief update service",
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("target") ?? "";
  const arch = request.nextUrl.searchParams.get("arch") ?? "";
  const currentVersion =
    request.nextUrl.searchParams.get("current_version") ?? "";
  const patterns = PLATFORM_ASSETS[`${target}-${arch}`];

  if (!patterns) return new NextResponse(null, { status: 204 });

  const releaseResponse = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
    {
      headers: githubHeaders("application/vnd.github+json"),
      next: { revalidate: 300 },
    },
  );

  if (!releaseResponse.ok) return new NextResponse(null, { status: 204 });

  const release = (await releaseResponse.json()) as GitHubRelease;
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

  const signatureResponse = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/assets/${signatureAsset.id}`,
    {
      headers: githubHeaders("application/octet-stream"),
      cache: "no-store",
    },
  );
  if (!signatureResponse.ok) {
    return new NextResponse(null, { status: 204 });
  }

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
