import { HttpError } from "./http";

const SOCKET_TICKET_SUFFIX = "/socket-tickets";
const DEVICE_BIND_PATH = "/v1/identity/device";

export async function enforceEdgeRequestLimit(
  env: Pick<Env, "EDGE_REQUEST_RATE_LIMITER">,
  request: Request,
) {
  const key = edgeKey(request);
  await requireAllowance(env.EDGE_REQUEST_RATE_LIMITER, key);
}

/** Protects the unauthenticated database-backed surfaces before Better Auth or
 * device binding can perform any D1 or Durable Object work. */
export async function enforcePublicIdentityRequestLimit(
  env: Pick<Env, "AUTH_REQUEST_RATE_LIMITER" | "DEVICE_BIND_RATE_LIMITER">,
  request: Request,
) {
  const pathname = new URL(request.url).pathname;
  const key = edgeKey(request);
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    await requireAllowance(env.AUTH_REQUEST_RATE_LIMITER, key);
  }
  if (pathname === DEVICE_BIND_PATH) {
    await requireAllowance(env.DEVICE_BIND_RATE_LIMITER, key);
  }
}

export async function enforceIdentityRequestLimits(
  env: Pick<
    Env,
    "IDENTITY_REQUEST_RATE_LIMITER" | "SOCKET_TICKET_RATE_LIMITER"
  >,
  request: Request,
  pubkey: string,
) {
  await requireAllowance(env.IDENTITY_REQUEST_RATE_LIMITER, pubkey);
  if (new URL(request.url).pathname.endsWith(SOCKET_TICKET_SUFFIX)) {
    await requireAllowance(env.SOCKET_TICKET_RATE_LIMITER, pubkey);
  }
}

async function requireAllowance(limiter: RateLimit, key: string) {
  const { success } = await limiter.limit({ key });
  if (success) return;
  throw new HttpError(
    429,
    "rate_limit_exceeded",
    "Chief is receiving too many requests from this device. Try again shortly.",
  );
}

function edgeKey(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "unknown-edge";
}
