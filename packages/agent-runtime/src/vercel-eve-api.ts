import { z } from "zod";

import type { JsonValue } from "@chief/relay-contracts";
import { parseJsonValue } from "@chief/relay-contracts";

export const projectIdentitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  accountId: z.string().min(1),
});

export const deploymentSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    readyState: z.string().nullish(),
    url: z.string().nullish(),
    inspectorUrl: z.string().url().nullish(),
  })
  .passthrough();
export const teamsSchema = z.object({
  teams: z.array(
    z.object({ id: z.string().min(1), name: z.string(), slug: z.string() }),
  ),
});
export const projectsSchema = z.object({
  projects: z.array(
    z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        framework: z.string().nullish(),
        latestDeployments: z
          .array(
            z.object({
              target: z.string().nullish(),
              url: z.string().nullish(),
            }),
          )
          .nullish(),
      })
      .passthrough(),
  ),
});
export const unknownSchema = z.unknown();
export const deploymentEventsSchema = z.array(
  z
    .object({
      type: z.string().optional(),
      created: z.number().optional(),
      text: z.string().optional(),
      payload: z
        .object({
          text: z.string().optional(),
          date: z.number().optional(),
          created: z.number().optional(),
          info: z
            .union([
              z.string(),
              z
                .object({
                  name: z.string().optional(),
                  step: z.string().optional(),
                  readyState: z.string().optional(),
                })
                .passthrough(),
            ])
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
);
export const vercelReadyStateSchema = z.enum([
  "QUEUED",
  "INITIALIZING",
  "BUILDING",
  "READY",
  "ERROR",
  "CANCELED",
]);
export const environmentKeysSchema = z.union([
  z.array(z.object({ key: z.string() }).passthrough()),
  z.object({
    envs: z.array(z.object({ key: z.string() }).passthrough()),
  }),
]);
export const eventsEnvelopeSchema = z.object({
  events: deploymentEventsSchema,
});

export function vercelUrl(
  path: string,
  query?: Readonly<Record<string, string>>,
) {
  const url = new URL(path, "https://api.vercel.com");
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function requestJson<T>({
  fetcher,
  init,
  schema,
  token,
  url,
  errorMessage,
}: {
  fetcher: typeof fetch;
  init?: RequestInit;
  schema: z.ZodType<T>;
  token: string;
  url: URL;
  errorMessage?: string;
}): Promise<T> {
  if (url.origin !== "https://api.vercel.com" || url.username || url.password) {
    throw new Error("Vercel credentials can only be sent to the Vercel API.");
  }
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetcher(url, {
    ...init,
    headers,
    redirect: "manual",
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Vercel did not respond within 20 seconds.");
    }
    throw error;
  });
  const text = await response.text();
  const body = parseJsonBody(
    text,
    `Vercel returned a web page (${response.status}) instead of JSON.`,
  );
  if (!response.ok) {
    const parsed = z
      .object({ error: z.object({ message: z.string() }).optional() })
      .passthrough()
      .safeParse(body);
    throw new Error(
      errorMessage ??
        (parsed.success && parsed.data.error?.message
          ? parsed.data.error.message
          : `Vercel returned ${response.status}.`),
    );
  }
  return schema.parse(body);
}

export function parseJsonBody(
  text: string,
  htmlMessage: string,
): JsonValue | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("<")) {
    throw new Error(htmlMessage);
  }
  try {
    const parsed = parseJsonValue(JSON.parse(trimmed));
    if (parsed === undefined) {
      throw new Error(htmlMessage);
    }
    return parsed;
  } catch {
    throw new Error(htmlMessage);
  }
}
