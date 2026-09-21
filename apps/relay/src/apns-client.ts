import type { JsonObject, PushEnvironment } from "@chief/relay-contracts";
import { messagePreviewText } from "@chief/relay-contracts";

interface ApnsEnv {
  APNS_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
}

interface ApnsAlert {
  token: string;
  environment: PushEnvironment;
  title: string;
  body: string;
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
  mentioned?: boolean;
}

export function conversationPushUrl(alert: {
  workspaceId: string;
  conversationId: string;
  threadRootId?: string;
}) {
  const url = new URL("chief-mobile://conversation");
  url.searchParams.set("workspace", alert.workspaceId);
  url.searchParams.set("channel", alert.conversationId);
  if (alert.threadRootId) url.searchParams.set("thread", alert.threadRootId);
  return url.toString();
}

let cachedJwt: { token: string; expiresAt: number } | null = null;

export function apnsReady(env: ApnsEnv) {
  return Boolean(
    env.APNS_P8?.trim() &&
    env.APNS_KEY_ID?.trim() &&
    env.APNS_TEAM_ID?.trim() &&
    env.APNS_BUNDLE_ID?.trim(),
  );
}

export async function sendApnsAlert(env: ApnsEnv, alert: ApnsAlert) {
  const topic = env.APNS_BUNDLE_ID?.trim();
  if (!topic) return 0;
  const jwt = await apnsJwt(env);
  if (!jwt) return 0;
  const host =
    alert.environment === "production"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${alert.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: {
          title: alert.title,
          body: Array.from(
            messagePreviewText(alert.body) || "Sent an attachment",
          )
            .slice(0, 180)
            .join(""),
        },
        sound: "default",
        badge: 1,
        "thread-id": `${alert.workspaceId}:${alert.conversationId}`,
        "target-content-identifier": alert.conversationId,
        "interruption-level": "active",
      },
      workspaceID: alert.workspaceId,
      conversationID: alert.conversationId,
      url: conversationPushUrl(alert),
      ...(alert.threadRootId
        ? { threadRootID: alert.threadRootId }
        : undefined),
      ...(alert.mentioned ? { mentioned: true } : undefined),
    }),
  });
  return response.status;
}

async function apnsJwt(env: ApnsEnv) {
  const pem = env.APNS_P8?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  if (!pem || !keyId || !teamId) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt - 60 > now) return cachedJwt.token;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = encodeJson({ alg: "ES256", kid: keyId });
  const payload = encodeJson({ iss: teamId, iat: now });
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned),
  );
  const token = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  cachedJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

function pemToPkcs8(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/u, "")
    .replace(/-----END PRIVATE KEY-----/u, "")
    .replace(/\s+/gu, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function encodeJson(value: JsonObject) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
