/**
 * Social platforms a workspace can register a presence on. Prefixes are the
 * canonical profile URL stems shown in the PrefixedInput; the backend keeps
 * this map to derive
 * stored URLs server-side.
 */
export type SocialPlatform =
  "x" | "instagram" | "linkedin" | "tiktok" | "youtube" | "reddit";

export interface SocialPlatformDef {
  platform: SocialPlatform;
  label: string;
  prefix: string;
}

export const SOCIAL_PLATFORMS: SocialPlatformDef[] = [
  { platform: "x", label: "X", prefix: "x.com/" },
  { platform: "instagram", label: "Instagram", prefix: "instagram.com/" },
  { platform: "linkedin", label: "LinkedIn", prefix: "linkedin.com/company/" },
  { platform: "tiktok", label: "TikTok", prefix: "tiktok.com/@" },
  { platform: "youtube", label: "YouTube", prefix: "youtube.com/@" },
  { platform: "reddit", label: "Reddit", prefix: "reddit.com/user/" },
];
