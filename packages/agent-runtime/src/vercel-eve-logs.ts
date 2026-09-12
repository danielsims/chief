import { z } from "zod";

import { parseJsonValue } from "@chief/relay-contracts";

import type {
  EveAgentProvisioningProgress,
  EveDeploymentLogLine,
  VercelDeploymentReadyState,
} from "./types.js";
import {
  deploymentEventsSchema,
  deploymentSchema,
  eventsEnvelopeSchema,
  requestJson,
  vercelReadyStateSchema,
  vercelUrl,
} from "./vercel-eve-api.js";

const maxDeploymentLogLines = 250;
const maxDeploymentLogChars = 800;
const nonemptyText = z.string().trim().min(1);

export function deploymentProgress(
  phase: "configuring" | "waiting",
  deployment: z.infer<typeof deploymentSchema>,
  extras: {
    logs?: EveDeploymentLogLine[];
    readyState?: VercelDeploymentReadyState;
    buildStartedAt?: number;
  } = {},
): EveAgentProvisioningProgress {
  const progress: EveAgentProvisioningProgress = {
    phase,
    projectId: deployment.projectId,
    deploymentId: deployment.id,
  };
  if (deployment.url) progress.deploymentUrl = `https://${deployment.url}`;
  if (deployment.inspectorUrl) progress.inspectorUrl = deployment.inspectorUrl;
  const readyState =
    extras.readyState ?? parseReadyState(deployment.readyState);
  if (readyState) progress.readyState = readyState;
  if (extras.buildStartedAt) progress.buildStartedAt = extras.buildStartedAt;
  if (extras.logs?.length) progress.logs = extras.logs;
  return progress;
}

export async function waitForDeployment({
  buildStartedAt,
  deploymentId,
  expectedProjectId,
  fetcher,
  maxWaitMs,
  onProgress,
  pollIntervalMs,
  teamId,
  token,
}: {
  buildStartedAt: number;
  deploymentId: string;
  expectedProjectId?: string;
  fetcher: typeof fetch;
  maxWaitMs: number;
  onProgress?: (progress: EveAgentProvisioningProgress) => void;
  pollIntervalMs: number;
  teamId: string;
  token: string;
}) {
  const deadline = Date.now() + maxWaitMs;
  let since = 0;
  const logs: EveDeploymentLogLine[] = [];
  const seen = new Set<string>();
  let latest: z.infer<typeof deploymentSchema> | undefined;
  const abort = new AbortController();
  let fetchedEventSnapshot = false;
  const appendEvents = (events: ReturnType<typeof parseDeploymentEvents>) => {
    for (const event of events) {
      const created = eventTimestamp(event);
      if (created > since) since = created;
      for (const line of formatVercelDeploymentLogs([event])) {
        const key = `${line.at ?? 0}:${line.source}:${line.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        logs.push(line);
      }
    }
    if (logs.length > maxDeploymentLogLines) {
      logs.splice(0, logs.length - maxDeploymentLogLines);
    }
  };
  const emit = (deployment: z.infer<typeof deploymentSchema>) => {
    latest = deployment;
    onProgress?.(
      deploymentProgress("waiting", deployment, {
        buildStartedAt,
        logs: [...logs],
        readyState: parseReadyState(deployment.readyState),
      }),
    );
  };
  const follow = followDeploymentEvents({
    abort,
    deploymentId,
    fetcher,
    teamId,
    token,
    onEvents: (events) => {
      appendEvents(events);
      if (latest) emit(latest);
    },
  }).catch((error: unknown) => {
    if (abort.signal.aborted) return;
    const text = sanitizeDeploymentLogText(
      error instanceof Error ? error.message : "Could not stream Vercel logs.",
    );
    if (!text) return;
    appendEvents([
      { payload: { text: `Could not stream Vercel logs: ${text}` } },
    ]);
    if (latest) emit(latest);
  });
  try {
    while (Date.now() < deadline) {
      const deployment = await requestJson({
        fetcher,
        token,
        url: vercelUrl(`/v13/deployments/${encodeURIComponent(deploymentId)}`, {
          teamId,
        }),
        schema: deploymentSchema,
      });
      if (
        deployment.id !== deploymentId ||
        (expectedProjectId !== undefined &&
          deployment.projectId !== expectedProjectId)
      ) {
        throw new Error(
          "Vercel returned a different deployment or project while checking progress.",
        );
      }
      if (logs.length === 0 && !fetchedEventSnapshot) {
        fetchedEventSnapshot = true;
        const events = await fetchDeploymentEvents({
          deploymentId,
          fetcher,
          since,
          teamId,
          token,
        }).catch(() => []);
        appendEvents(events);
      }
      emit(deployment);
      if (deployment.readyState === "READY") return deployment;
      if (["ERROR", "CANCELED"].includes(deployment.readyState ?? "")) {
        const detail =
          logs.find(
            (line) => line.source === "fatal" || line.source === "stderr",
          )?.text ??
          logs.find((line) =>
            /error|failed|elifecycle|cannot|unable/iu.test(line.text),
          )?.text;
        throw new Error(
          detail
            ? `Vercel could not build the Eve agent: ${detail}`
            : "Vercel could not build the Eve agent. Open the deployment logs for details.",
        );
      }
      await sleep(pollIntervalMs);
    }
    throw new Error(
      "Vercel is still building the Eve agent. Open the deployment to check its progress.",
    );
  } finally {
    abort.abort();
    await follow.catch(() => undefined);
  }
}

async function followDeploymentEvents({
  abort,
  deploymentId,
  fetcher,
  onEvents,
  teamId,
  token,
}: {
  abort: AbortController;
  deploymentId: string;
  fetcher: typeof fetch;
  onEvents: (events: ReturnType<typeof parseDeploymentEvents>) => void;
  teamId: string;
  token: string;
}) {
  const url = vercelUrl(
    `/v3/deployments/${encodeURIComponent(deploymentId)}/events`,
    {
      builds: "1",
      direction: "forward",
      follow: "1",
      limit: "-1",
      teamId,
    },
  );
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: abort.signal,
  });
  if (!response.ok || !response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (!abort.signal.aborted) {
      const { done, value } = await reader.read();
      buffer += value ?? "";
      const lines = buffer.split(/\r?\n/u);
      buffer = done ? "" : (lines.pop() ?? "");
      const complete = done && buffer ? [...lines, buffer] : lines;
      const chunk = complete
        .filter((line) => line.trim().length > 0)
        .join("\n");
      if (chunk) onEvents(parseDeploymentEvents(chunk));
      if (done) break;
    }
  } catch (error: unknown) {
    if (abort.signal.aborted) return;
    throw error;
  }
}

async function fetchDeploymentEvents({
  deploymentId,
  fetcher,
  since,
  teamId,
  token,
}: {
  deploymentId: string;
  fetcher: typeof fetch;
  since?: number;
  teamId: string;
  token: string;
}) {
  const query: Record<string, string> = {
    builds: "1",
    direction: "forward",
    limit: "-1",
    teamId,
  };
  if (since) query.since = String(since);
  const url = vercelUrl(
    `/v3/deployments/${encodeURIComponent(deploymentId)}/events`,
    query,
  );
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) return [];
  return parseDeploymentEvents(body);
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseDeploymentEvents(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return [];
  const document = parseJsonDocument(trimmed);
  const fromArray = deploymentEventsSchema.safeParse(document);
  if (fromArray.success) return fromArray.data;
  const envelope = eventsEnvelopeSchema.safeParse(document);
  if (envelope.success) return envelope.data.events;
  const single = deploymentEventsSchema.safeParse([document]);
  return single.success ? single.data : [];
}

function parseJsonDocument(text: string) {
  try {
    return parseJsonValue(JSON.parse(text)) ?? [];
  } catch {
    return text.split(/\r?\n/u).flatMap((line) => {
      try {
        const parsed = parseJsonValue(JSON.parse(line));
        return parsed === undefined ? [] : [parsed];
      } catch {
        return [];
      }
    });
  }
}

export function formatVercelDeploymentLogs(
  events: ReturnType<typeof parseDeploymentEvents>,
): EveDeploymentLogLine[] {
  return events.flatMap((event) => {
    const type = eventType(event);
    if (
      type === "delimiter" ||
      type === "metric" ||
      type === "middleware" ||
      type === "middleware-invocation" ||
      type === "edge-function-invocation"
    ) {
      return [];
    }
    const text = sanitizeDeploymentLogText(eventText(event));
    if (!text) return [];
    const at = eventTimestamp(event);
    const line: EveDeploymentLogLine = { source: logSource(type), text };
    if (at > 0) line.at = at;
    return [line];
  });
}

function eventType(event: z.infer<typeof deploymentEventsSchema>[number]) {
  return event.type ?? "";
}

function eventTimestamp(event: z.infer<typeof deploymentEventsSchema>[number]) {
  if (event.created !== undefined) return event.created;
  const payload = event.payload;
  if (payload?.date !== undefined) return payload.date;
  if (payload?.created !== undefined) return payload.created;
  return 0;
}

function eventText(event: z.infer<typeof deploymentEventsSchema>[number]) {
  const values: string[] = [];
  pushNonempty(values, event.text);
  pushNonempty(values, event.payload?.text);
  const info = event.payload?.info;
  if (info === undefined) return values[0];
  const asText = nonemptyText.safeParse(info);
  if (asText.success) {
    values.push(asText.data);
    return values[0];
  }
  const asObject = z
    .object({
      name: z.string().optional(),
      step: z.string().optional(),
      readyState: z.string().optional(),
    })
    .safeParse(info);
  if (asObject.success) {
    pushNonempty(
      values,
      [asObject.data.name, asObject.data.step, asObject.data.readyState]
        .flatMap((part) => {
          const parsed = nonemptyText.safeParse(part);
          return parsed.success ? [parsed.data] : [];
        })
        .join(" · "),
    );
  }
  return values[0];
}

function pushNonempty(values: string[], value: string | undefined) {
  const parsed = nonemptyText.safeParse(value);
  if (parsed.success) values.push(parsed.data);
}

function logSource(type: string): EveDeploymentLogLine["source"] {
  if (
    type === "command" ||
    type === "stdout" ||
    type === "stderr" ||
    type === "fatal"
  ) {
    return type;
  }
  return "status";
}

function parseReadyState(value: string | null | undefined) {
  const parsed = vercelReadyStateSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function sanitizeDeploymentLogText(value: string | undefined) {
  if (!value) return "";
  return stripAnsiAndControls(redactLogLine(value))
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
    .slice(0, maxDeploymentLogChars);
}

function stripAnsiAndControls(text: string) {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x1b && text[index + 1] === "[") {
      index += 2;
      while (index < text.length) {
        const end = text.charCodeAt(index);
        index += 1;
        if ((end >= 65 && end <= 90) || (end >= 97 && end <= 122)) break;
      }
      continue;
    }
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code !== 127)
    ) {
      result += text[index];
    }
    index += 1;
  }
  return result;
}

function redactLogLine(value: string) {
  return value
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(
      /(TOKEN|SECRET|SIGNING_KEY|AUTHORIZATION)(\s*[:=]\s*)\S+/giu,
      "$1$2[redacted]",
    );
}
