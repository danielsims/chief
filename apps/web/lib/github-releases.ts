import { env } from "./env";

const REPOSITORY = "danielsims/chief";

export interface GitHubAsset {
  id: number;
  name: string;
}

export interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  assets: GitHubAsset[];
}

export function githubHeaders(accept: string) {
  return {
    Accept: accept,
    "User-Agent": "Chief release service",
    ...(env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` }
      : undefined),
  };
}

export async function getLatestRelease(): Promise<GitHubRelease | null> {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
    {
      headers: githubHeaders("application/vnd.github+json"),
      next: { revalidate: 300 },
    },
  );

  if (!response.ok) return null;
  return (await response.json()) as GitHubRelease;
}

export async function getReleaseAssetDownloadUrl(
  assetId: number,
): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/releases/assets/${assetId}`,
    {
      headers: githubHeaders("application/octet-stream"),
      redirect: "manual",
      cache: "no-store",
    },
  );

  return response.headers.get("location");
}
