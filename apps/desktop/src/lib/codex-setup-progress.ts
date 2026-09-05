import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { z } from "zod";

const progressSchema = z
  .object({
    state: z.enum(["downloading", "ready", "error"]),
    label: z.string(),
    percent: z.number().optional(),
    updatedAt: z.number(),
  })
  .nullable();
const watching = new Set<string>();

export function watchCodexSetup(
  relayUrl: string,
  workspaceId: string,
  agentId: string,
) {
  const key = `${relayUrl}:${workspaceId}:${agentId}`;
  if (watching.has(key)) return;
  watching.add(key);
  const started = Date.now();
  const toastId = `codex-setup:${key}`;
  let visible = false;
  const poll = async () => {
    try {
      const progress = progressSchema.parse(
        await invoke("cell_runtime_setup", { relayUrl, workspaceId, agentId }),
      );
      if (progress && progress.updatedAt >= started - 5_000) {
        if (progress.state === "ready") {
          if (visible) toast.success("Codex is ready", { id: toastId });
          watching.delete(key);
          return;
        }
        if (progress.state === "error") {
          toast.error(progress.label, { id: toastId });
          visible = true;
        } else {
          toast.loading(
            `${progress.label}${progress.percent === undefined ? "…" : ` · ${progress.percent}%`}`,
            { id: toastId },
          );
          visible = true;
        }
      }
      if (Date.now() - started < 5 * 60_000)
        window.setTimeout(() => void poll(), 1_000);
      else {
        watching.delete(key);
        toast.dismiss(toastId);
      }
    } catch {
      watching.delete(key);
      if (visible) toast.dismiss(toastId);
    }
  };
  void poll();
}
