import { z } from "zod";

import { env } from "./env";

const REPOSITORY = "danielsims/chief";

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  body: z.string().nullable(),
  published_at: z.string(),
  assets: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
    }),
  ),
});

export type GitHubRelease = z.infer<typeof githubReleaseSchema>;

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

  const release = githubReleaseSchema.safeParse(await response.json());
  return release.success ? release.data : null;
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
