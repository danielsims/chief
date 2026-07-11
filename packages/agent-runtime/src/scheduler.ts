import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { composeWorkspaceInstructions, getAgent } from "./agents.js";
import { runDateKey } from "./recurring-work.js";
import { readWorkspaceContext } from "./workspace-context.js";
import { SessionManager } from "./manager.js";
import { nextRunAt } from "./recurring-work.js";
import { AgentSession } from "./session.js";
import { existingExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import type {
  AgentEvent,
  RecurringWorkRecord,
  RecurringWorkRunRecord,
} from "./types.js";
import { workspaceRoot, workspaceSecrets } from "./workspace-secrets.js";

const POLL_INTERVAL_MS = 30_000;

function lastAssistantText(events: readonly AgentEvent[]) {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          )
        : [],
    )
    .at(-1)
    ?.slice(0, 2_000);
}

export class RecurringWorkScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Set<string>();

  constructor(
    private readonly manager: SessionManager,
    private readonly onChange: (workspaceId: string) => void | Promise<void>,
  ) {}

  start() {
    if (this.timer) return;
    // Fire-and-forget: a failed tick logs and waits for the next interval
    // instead of surfacing an unhandled rejection that kills the runtime.
    const safeTick = () =>
      void this.tick().catch((error) =>
        console.error("[scheduler] tick failed:", error),
      );
    safeTick();
    this.timer = setInterval(safeTick, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(workspaceId: string, recurringWorkId: string) {
    const work = await this.manager.recurringWorkById(
      workspaceId,
      recurringWorkId,
    );
    if (!work) throw new Error("Recurring work was not found.");
    if (!work.grant) throw new Error("Recurring work has not been approved.");
    await this.run(workspaceId, work, Date.now(), { claim: false });
  }

  private async tick() {
    const due = await this.manager.dueRecurringWork(Date.now());
    await Promise.all(
      due.map((work) =>
        this.run(
          work.workspaceId,
          {
            ...work,
            grant: work.grant ?? undefined,
            skipDates: work.skipDates ?? undefined,
            nextRunAt: work.nextRunAt ?? undefined,
            lastRunAt: work.lastRunAt ?? undefined,
            lastResult: work.lastResult ?? undefined,
          },
          work.nextRunAt!,
          { claim: true },
        ).catch((error) =>
          console.error(`[scheduler] run ${work.id} failed:`, error),
        ),
      ),
    );
  }

  /**
   * A run's outcome must be reviewable: the transcript persists as a durable
   * conversation under the automation's name, and anything short of success
   * raises exactly one attention item with the concrete reason.
   */
  private async deliverRunOutcome(
    workspaceId: string,
    work: RecurringWorkRecord,
    session: AgentSession | null,
    status: "completed" | "failed" | "needs_approval",
    detail?: string,
  ) {
    try {
      if (session) {
        await this.manager.saveTranscript(
          {
            id: `automation-${work.id}`,
            workspaceId,
            agentId: work.agentId,
            driver: "codex",
          },
          session.events,
          work.title,
        );
      }
      if (status !== "completed") {
        await this.manager.raiseAttentionItem(workspaceId, {
          id: `attention-${work.id}-${status}`,
          agentId: work.agentId,
          title: work.title,
          reason:
            status === "needs_approval"
              ? detail?.trim() ||
                "The run stopped at an action outside its approved scope."
              : detail?.trim() || "The run failed.",
          sourceId: `automation-${work.id}`,
          status: "open",
          createdAt: Date.now(),
        });
      }
    } catch (error) {
      console.error("[scheduler] could not deliver run outcome:", error);
    }
  }

  private async run(
    workspaceId: string,
    work: RecurringWorkRecord,
    scheduledFor: number,
    { claim }: { claim: boolean },
  ) {
    if (this.running.has(work.id) || !work.grant) return;
    this.running.add(work.id);
    const now = Date.now();
    // Downtime recovery is one catch-up run, not a replay: the next
    // occurrence is computed from now when the due time is already past,
    // otherwise a week offline would refire a daily job seven times.
    const scheduleFrom = () => Math.max(scheduledFor, Date.now());
    if (claim) {
      // Scheduled dispatch must win an atomic claim on the due time so a
      // second runtime polling the same database cannot run the same job.
      const claimed = await this.manager.claimRecurringWork(
        workspaceId,
        work.id,
        scheduledFor,
        nextRunAt(work.cron, work.timezone, scheduleFrom()),
      );
      if (!claimed) {
        this.running.delete(work.id);
        return;
      }
    } else {
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        nextRunAt: nextRunAt(work.cron, work.timezone, scheduleFrom()),
        updatedAt: now,
      });
    }
    // A skipped occurrence consumes its claim (nextRunAt already advanced)
    // without executing, and the spent skip date is cleared.
    const skipKey = runDateKey(scheduledFor, work.timezone);
    if (claim && work.skipDates?.includes(skipKey)) {
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        skipDates: work.skipDates.filter((date) => date !== skipKey),
        nextRunAt: nextRunAt(work.cron, work.timezone, scheduleFrom()),
        updatedAt: Date.now(),
      });
      this.running.delete(work.id);
      await this.onChange(workspaceId);
      return;
    }

    const run: RecurringWorkRunRecord = {
      id: randomUUID(),
      recurringWorkId: work.id,
      status: "running",
      scheduledFor,
      startedAt: now,
    };

    let session: AgentSession | null = null;
    let blocked = false;
    try {
      await this.manager.saveRecurringWorkRun(workspaceId, run);
      await this.onChange(workspaceId);
      const agent = getAgent(work.agentId);
      if (!agent) throw new Error(`Unknown agent: ${work.agentId}`);
      const preference = await this.manager.agentPreference(
        workspaceId,
        work.agentId,
      );
      if (preference?.enabled === false) {
        throw new Error(`${agent.name} is disabled.`);
      }

      const cwd = join(workspaceRoot(workspaceId), "automations", work.id);
      mkdirSync(cwd, { recursive: true });
      const env = await workspaceSecrets.materialize(workspaceId);
      const executor = existingExecutorWorkspace(workspaceId);
      const approved = work.grant.toolPatterns;
      const scheduledAgent = {
        ...agent,
        instructions: composeWorkspaceInstructions(
          `${agent.instructions}\n\nThis is an unattended recurring run that the user approved in Marketer. Use Executor only; do not use shell commands or edit files. You may call only these delegated Executor tools: ${approved.length > 0 ? approved.join(", ") : "read-only tools that Executor already allows"}. If the task needs any other mutation, stop and explain what additional approval is required.`,
          readWorkspaceContext(workspaceId),
        ),
      };
      session = new AgentSession(scheduledAgent, `automation-${run.id}`, {
        // Codex currently exposes Executor's native MCP elicitation to the
        // host, allowing this grant to be enforced before every mutation.
        driver: "codex",
        access: "guarded",
        workspaceId,
        env,
        model: preference?.model,
        mcpServers: [executorToolServer(executor)],
        automationGrant: work.grant,
      });

      const result = await new Promise<{ ok: boolean; error?: string }>(
        async (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Recurring work timed out.")),
            10 * 60_000,
          );
          timeout.unref();
          session!.on("event", (event: AgentEvent) => {
            if (event.type === "permission") blocked = true;
            if (event.type === "result") {
              clearTimeout(timeout);
              resolve({ ok: event.ok, error: event.error });
            }
            if (event.type === "error") {
              clearTimeout(timeout);
              resolve({ ok: false, error: event.message });
            }
          });
          try {
            await session!.start(cwd);
            await session!.sendPrompt(
              `Run this approved recurring work now.\n\n${work.instructions}\n\nReturn a concise summary of what changed, what was saved or sent, and anything that needs the user's attention.`,
            );
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        },
      );

      const summary = lastAssistantText(session.events);
      const status = blocked
        ? "needs_approval"
        : result.ok
          ? "completed"
          : "failed";
      await this.manager.saveRecurringWorkRun(workspaceId, {
        ...run,
        status,
        finishedAt: Date.now(),
        summary,
        error: result.error,
      });
      // Every run leaves a reviewable conversation, and a blocked run raises
      // one concrete attention item instead of failing silently.
      await this.deliverRunOutcome(workspaceId, work, session, status, summary);
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        status: blocked ? "needs_approval" : "active",
        nextRunAt: nextRunAt(work.cron, work.timezone, scheduleFrom()),
        lastRunAt: Date.now(),
        lastResult: summary ?? result.error,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.manager.saveRecurringWorkRun(workspaceId, {
        ...run,
        status: blocked ? "needs_approval" : "failed",
        finishedAt: Date.now(),
        error: message,
      });
      await this.deliverRunOutcome(
        workspaceId,
        work,
        session,
        blocked ? "needs_approval" : "failed",
        message,
      );
      await this.manager.saveRecurringWork(workspaceId, {
        ...work,
        // A transient provider or network failure is recorded on the run but
        // does not silently disable an automation the user approved forever.
        status: blocked ? "needs_approval" : "active",
        nextRunAt: blocked
          ? work.nextRunAt
          : nextRunAt(work.cron, work.timezone, scheduleFrom()),
        lastRunAt: Date.now(),
        lastResult: message,
        updatedAt: Date.now(),
      });
    } finally {
      await session?.stop().catch(() => {});
      this.running.delete(work.id);
      await this.onChange(workspaceId);
    }
  }
}
