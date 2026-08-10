import type { HandleMessageStreamEvent, InputResponse } from "eve/client";
import { Client, resolveTextToResponse } from "eve/client";

import type { ContentBlock, StartOptions } from "../types.js";
import type { RemoteDriverState } from "./remote-eve-state.js";
import {
  DeploymentNotFoundError,
  isDeploymentNotFound,
  safeRuntimeError,
} from "../deployment-failure.js";
import { BaseDriver } from "./base.js";
import {
  remoteActionName,
  remoteResultOutput,
  savedRemoteDriverState,
} from "./remote-eve-state.js";
import { remoteHistoryContext } from "./remote-history.js";

export class EveRemoteDriver extends BaseDriver {
  protected override promptCompletesFromEvents = true;
  private client: Client | undefined;
  private session: ReturnType<Client["session"]> | undefined;
  private state: RemoteDriverState | undefined;
  private runtimeContext: string | undefined;
  private initialHistory: StartOptions["history"];
  private streamAbort: AbortController | undefined;
  private pumping: Promise<void> | undefined;
  private stopped = false;

  async start(options: StartOptions) {
    this.startOptions = options;
    const host = options.env?.CHIEF_REMOTE_AGENT_URL?.trim();
    const password = options.env?.CHIEF_EVE_ROUTE_PASSWORD?.trim();
    if (!host || !password) {
      throw new Error(
        "This workspace has no authenticated cloud agent deployment. Deploy it again from Agents.",
      );
    }
    const url = new URL(host);
    if (url.protocol !== "https:") {
      throw new Error("The cloud agent URL must use HTTPS.");
    }
    this.state = savedRemoteDriverState(options.resumeState, url.origin) ?? {
      version: 1,
      host: url.origin,
      session: { streamIndex: 0 },
      inFlight: false,
      awaitingInput: false,
    };
    const runtimeContext = options.runtimeContext?.trim();
    this.runtimeContext = runtimeContext?.length ? runtimeContext : undefined;
    this.initialHistory = this.state.session.sessionId
      ? undefined
      : options.history;
    this.client = new Client({
      host: url.origin,
      auth: { basic: { username: "chief-desktop", password } },
      redirect: "error",
      maxReconnectAttempts: 5,
      preserveCompletedSessions: true,
    });
    try {
      await this.client.info();
    } catch (error) {
      if (isDeploymentNotFound(error)) {
        throw new DeploymentNotFoundError({ cause: error });
      }
      throw error;
    }
    this.session = this.client.session(this.state.session);
    if (this.state.session.sessionId) {
      this.emitEvent({
        type: "init",
        sessionId: this.state.session.sessionId,
      });
    }
    this.emitState(this.state);
    if (this.state.inFlight && !this.state.awaitingInput) {
      this.streamAbort = new AbortController();
      this.pumping = this.pump(
        this.session.stream({
          startIndex: this.state.session.streamIndex,
          signal: this.streamAbort.signal,
        }),
      );
    } else if (this.state.awaitingInput) {
      this.emitPendingRequests();
      this.emitEvent({ type: "status", status: "waiting" });
    }
  }

  async sendPromptOnce(text: string) {
    if (!this.session || !this.state)
      throw new Error("Remote agent not started.");
    if (this.pumping || this.state.inFlight)
      throw new Error("The remote agent is already running.");
    this.stopped = false;
    const context = [
      this.runtimeContext,
      remoteHistoryContext(this.initialHistory, text),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.slice(0, 40_000));
    this.initialHistory = undefined;
    const response = await this.session.send({
      message: text,
      clientContext: context,
    });
    const firstSession = !this.state.session.sessionId;
    this.state = {
      ...this.state,
      session: {
        ...this.session.state,
        sessionId: response.sessionId,
        continuationToken:
          response.continuationToken ?? this.session.state.continuationToken,
      },
      inFlight: true,
      awaitingInput: false,
      pendingRequests: undefined,
      turnStartedAt: Date.now(),
      costUsd: 0,
    };
    if (firstSession) {
      this.emitEvent({ type: "init", sessionId: response.sessionId });
    }
    this.emitEvent({ type: "status", status: "running" });
    this.emitState(this.state);
    this.pumping = this.pump(response);
  }

  async interrupt() {
    this.interrupted = true;
    if (!this.session || !this.state?.session.sessionId) return;
    await this.session.cancel(
      this.state.activeTurnId ? { turnId: this.state.activeTurnId } : undefined,
    );
  }

  /** Recover from a failed prompt by reconnecting to the cloud agent. */
  async restart() {
    if (this.startOptions) {
      await this.start({ ...this.startOptions, resumeState: this.state });
    }
  }

  async stop() {
    this.stopped = true;
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    await this.pumping?.catch(() => undefined);
    this.pumping = undefined;
  }

  respondPermission(requestId: string, behavior: "allow" | "deny") {
    const request = this.state?.pendingRequests?.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (!request) return;
    void this.resumeInput({
      requestId,
      optionId: behavior === "allow" ? "approve" : "deny",
    });
  }

  respondQuestion(requestId: string, answers: Record<string, string> | null) {
    const request = this.state?.pendingRequests?.find(
      (candidate) => candidate.requestId === requestId,
    );
    if (!request || !answers) return;
    const answer = Object.values(answers).find((value) => value.trim());
    if (!answer) return;
    const response = resolveTextToResponse(answer, request) ?? {
      requestId,
      text: answer,
    };
    void this.resumeInput(response);
  }

  private async resumeInput(response: InputResponse) {
    if (!this.session || !this.state || this.pumping) return;
    const resolvedRequest = this.state.pendingRequests?.find(
      (request) => request.requestId === response.requestId,
    );
    if (resolvedRequest?.display !== "confirmation") {
      this.emitEvent({
        type: "questionResolved",
        requestId: response.requestId,
      });
    }
    const pendingRequests = (this.state.pendingRequests ?? []).filter(
      (request) => request.requestId !== response.requestId,
    );
    const turn = await this.session.send({ inputResponses: [response] });
    this.state = {
      ...this.state,
      session: {
        ...this.session.state,
        sessionId: turn.sessionId,
        continuationToken:
          turn.continuationToken ?? this.session.state.continuationToken,
      },
      inFlight: true,
      awaitingInput: pendingRequests.length > 0,
      pendingRequests: pendingRequests.length ? pendingRequests : undefined,
    };
    this.emitEvent({ type: "status", status: "running" });
    this.emitState(this.state);
    this.pumping = this.pump(turn);
  }

  private emitPendingRequests() {
    for (const request of this.state?.pendingRequests ?? []) {
      if (
        request.display === "confirmation" &&
        request.options?.some((option) => option.id === "approve") &&
        request.options.some((option) => option.id === "deny")
      ) {
        this.emitEvent({
          type: "permission",
          requestId: request.requestId,
          toolName: request.action.toolName,
          input: request.action.input,
        });
      } else {
        this.emitEvent({
          type: "question",
          requestId: request.requestId,
          questions: [
            {
              question: request.prompt,
              header: request.action.toolName,
              options: (request.options ?? []).map((option) => ({
                label: option.label,
                description: option.description,
              })),
              allowFreeform: request.allowFreeform ?? !request.options?.length,
              dismissible: false,
            },
          ],
        });
      }
    }
  }

  private async pump(stream: AsyncIterable<HandleMessageStreamEvent>) {
    let finished = false;
    let failed = false;
    try {
      for await (const event of stream) {
        this.mapEvent(event);
        if (!this.state || !this.session) continue;
        this.state = {
          ...this.state,
          session: {
            ...this.state.session,
            ...this.session.state,
            streamIndex: this.state.session.streamIndex + 1,
          },
        };
        this.emitState(this.state);
        if (
          event.type === "session.waiting" ||
          event.type === "session.completed" ||
          event.type === "session.failed"
        ) {
          finished = true;
        }
      }
      if (!finished && !this.stopped) {
        throw new Error(
          "The remote event stream ended before a turn boundary.",
        );
      }
    } catch (error) {
      failed = true;
      if (!this.stopped) {
        this.emitEvent({
          type: "error",
          message: safeRuntimeError(error),
          ...(isDeploymentNotFound(error)
            ? { code: "deployment_not_found" as const }
            : {}),
        });
        this.emitEvent({ type: "status", status: "idle" });
      }
    } finally {
      if (this.state && this.session) {
        this.state = {
          ...this.state,
          session: this.session.state,
          inFlight: !failed && !finished && !this.stopped,
        };
        this.emitState(this.state);
      }
      this.pumping = undefined;
    }
  }

  private emitSuccess() {
    this.emitEvent({
      type: "result",
      ok: true,
      costUsd: this.state?.costUsd,
      durationMs: this.state?.turnStartedAt
        ? Date.now() - this.state.turnStartedAt
        : undefined,
    });
    this.emitEvent({ type: "status", status: "idle" });
  }

  private mapEvent(event: HandleMessageStreamEvent) {
    if (!this.state) return;
    switch (event.type) {
      case "session.started":
        if (event.data.runtime?.modelId && this.state.session.sessionId) {
          this.emitEvent({
            type: "init",
            sessionId: this.state.session.sessionId,
            model: event.data.runtime.modelId,
          });
        }
        break;
      case "turn.started":
        this.state = {
          ...this.state,
          activeTurnId: event.data.turnId,
          turnStartedAt: Date.now(),
          costUsd: 0,
        };
        this.emitEvent({ type: "status", status: "running" });
        break;
      case "message.appended":
        this.emitEvent({ type: "stream", text: event.data.messageDelta });
        break;
      case "message.completed":
        if (event.data.message) {
          this.emitEvent({
            type: "message",
            id: `${event.data.turnId}-message-${event.data.stepIndex}`,
            role: "assistant",
            content: [{ type: "text", text: event.data.message }],
          });
        }
        break;
      case "reasoning.completed":
        if (event.data.reasoning) {
          this.emitEvent({
            type: "message",
            id: `${event.data.turnId}-reasoning-${event.data.stepIndex}`,
            role: "assistant",
            content: [{ type: "thinking", thinking: event.data.reasoning }],
          });
        }
        break;
      case "actions.requested": {
        const content: ContentBlock[] = event.data.actions.map((action) => ({
          type: "tool_use",
          id: action.callId,
          name: remoteActionName(action),
          input: action.input,
        }));
        if (content.length) {
          this.emitEvent({
            type: "message",
            id: `${event.data.turnId}-actions-${event.data.sequence}`,
            role: "assistant",
            content,
          });
        }
        break;
      }
      case "action.result":
        this.emitEvent({
          type: "message",
          id: `${event.data.turnId}-result-${event.data.result.callId}`,
          role: "assistant",
          content: [
            {
              type: "tool_result",
              tool_use_id: event.data.result.callId,
              content: remoteResultOutput(event.data.result),
              is_error:
                event.data.status !== "completed" ||
                event.data.result.isError === true,
            },
          ],
        });
        break;
      case "input.requested":
        this.state = {
          ...this.state,
          awaitingInput: true,
          pendingRequests: [...event.data.requests],
        };
        this.emitPendingRequests();
        this.emitEvent({ type: "status", status: "waiting" });
        break;
      case "step.completed":
        this.state = {
          ...this.state,
          costUsd: (this.state.costUsd ?? 0) + (event.data.usage?.costUsd ?? 0),
        };
        break;
      case "authorization.required": {
        const authorization = event.data.authorization;
        const details = authorization
          ? JSON.stringify(authorization)
          : event.data.webhookUrl;
        this.emitEvent({
          type: "message",
          role: "assistant",
          content: [
            {
              type: "text",
              text: [event.data.description, details]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        });
        this.emitEvent({ type: "status", status: "waiting" });
        break;
      }
      case "turn.cancelled":
        this.emitEvent({
          type: "result",
          ok: false,
          error: "Turn interrupted",
        });
        break;
      case "session.waiting":
        this.state = {
          ...this.state,
          session: {
            ...this.state.session,
            continuationToken: event.data.continuationToken,
          },
          inFlight: false,
        };
        if (this.state.awaitingInput) {
          this.emitEvent({ type: "status", status: "waiting" });
        } else {
          this.emitSuccess();
        }
        break;
      case "session.completed":
        this.state = { ...this.state, inFlight: false };
        this.emitSuccess();
        break;
      case "session.failed":
        this.state = { ...this.state, inFlight: false };
        this.emitEvent({
          type: "result",
          ok: false,
          error: event.data.message,
        });
        this.emitEvent({ type: "status", status: "idle" });
        break;
      default:
        break;
    }
  }
}
