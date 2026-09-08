import { z } from "zod";

const createdKeySchema = z
  .object({
    apiKeyString: z.string().min(1).optional(),
    key: z.string().min(1).optional(),
  })
  .passthrough();

/** Mints a Vercel AI Gateway key from a connected account token. */
export async function mintAiGatewayKey(
  token: string,
  teamId: string | undefined,
  name: string,
) {
  const url = new URL("https://api.vercel.com/v1/api-keys");
  if (teamId) url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ purpose: "ai-gateway", name }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Vercel could not create an AI Gateway key (${response.status}).`,
    );
  }
  const parsed = createdKeySchema.safeParse(
    text.trim() ? JSON.parse(text) : null,
  );
  const secret = parsed.success
    ? (parsed.data.apiKeyString ?? parsed.data.key)
    : undefined;
  if (!secret) {
    throw new Error("Vercel did not return an AI Gateway key.");
  }
  return secret;
}
