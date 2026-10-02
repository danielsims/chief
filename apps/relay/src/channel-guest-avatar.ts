import { matchesImageSignature, normalizedImageType } from "./attachments";
import { requirePublicHttpsUrl } from "./channel-guest-crypto";

const maximumAvatarBytes = 1024 * 1024;
const fetchTimeoutMs = 5_000;
const maximumRedirects = 2;

/**
 * Copies an agent's profile image into the relay once, so people never load
 * a third-party URL (no tracking, no later swaps) and the relay never follows
 * one to a private address. Best effort: any failure leaves the guest without
 * an image rather than failing the join.
 */
export async function storeGuestAvatar(
  env: Env,
  origin: string,
  guestId: string,
  source: string,
) {
  try {
    const image = await fetchImage(source);
    if (!image) return null;
    const key = `guests/${guestId}`;
    await env.ARTIFACTS.put(key, image.bytes, {
      customMetadata: { contentType: image.contentType },
      httpMetadata: { contentType: image.contentType },
    });
    return `${origin}/v1/assets/guests/${encodeURIComponent(guestId)}`;
  } catch {
    return null;
  }
}

async function fetchImage(source: string) {
  let url = requirePublicHttpsUrl(source);
  for (let hop = 0; hop <= maximumRedirects; hop += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "image/png, image/jpeg, image/webp, image/gif" },
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      // Every hop is checked again, so a redirect cannot reach a private host.
      url = requirePublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    const contentType = normalizedImageType(
      response.headers.get("content-type") ?? "",
    );
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok || !contentType || declared > maximumAvatarBytes) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readLimited(response, maximumAvatarBytes);
    if (!bytes || !matchesImageSignature(bytes, contentType)) return null;
    return { bytes, contentType };
  }
  return null;
}

async function readLimited(response: Response, limit: number) {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
    response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
