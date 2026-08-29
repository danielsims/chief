import { z } from "zod";

import type { ExecutorManifest } from "./executor-api-schemas.js";

export const emptyResponseSchema = z.unknown();

export async function requestExecutor<T>(
  manifest: ExecutorManifest,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const auth = manifest.connection.auth;
  const authorization =
    auth.kind === "bearer"
      ? `Bearer ${auth.token}`
      : auth.kind === "oauth"
        ? `Bearer ${auth.accessToken}`
        : `Basic ${Buffer.from(`${auth.username ?? "executor"}:${auth.password}`).toString("base64")}`;
  const response = await fetch(`${manifest.connection.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authorization,
      ...(init?.body ? { "Content-Type": "application/json" } : undefined),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Local connection ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body.slice(0, 500)}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(`Local connection ${path} returned invalid JSON.`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Local connection ${path} returned an invalid response.`);
  }
  return parsed.data;
}
