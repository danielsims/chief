import { z } from "zod";

import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import { currentTime, isTimeZone } from "@chief/agent-runtime/web-reading";
import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

import type { HostedAgentToolContext } from "../context";
import { optionalString } from "../input";
import { defineHostedAgentTool } from "../tool";
import { workspaceOperation } from "./channels";

export const hostedTimeTools = [
  defineHostedAgentTool(
    "time.now",
    async (context, input) => {
      const asked = optionalString(input, "timeZone");
      if (asked && !isTimeZone(asked))
        throw new RecoverableToolError(
          `${asked} isn't an IANA time zone, such as America/New_York.`,
        );
      return currentTime(new Date(), {
        user: await requesterTimeZone(context),
        ...(asked ? { asked } : undefined),
      });
    },
    { effect: "read_only" },
  ),
];

/** The time zone of the person whose message this turn answers, if known. */
async function requesterTimeZone(
  context: Pick<HostedAgentToolContext, "env" | "job" | "principal">,
) {
  const author = parseJsonObject(
    parseJsonObject(context.job.payload.message)?.author,
  );
  if (author?.kind !== "user" || !isJsonString(author.id)) return undefined;
  try {
    return z
      .object({ timeZone: z.string().optional() })
      .parse(
        await workspaceOperation(
          context.env,
          context.job,
          context.principal,
          "member-time-zone-get",
          { body: { userId: author.id } },
        ),
      ).timeZone;
  } catch {
    return undefined;
  }
}
