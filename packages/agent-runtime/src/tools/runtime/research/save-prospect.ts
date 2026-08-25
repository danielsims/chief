import { randomUUID } from "node:crypto";

import type { ProspectRecord } from "../../../types.js";
import { time } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { saveProspectDefinition } from "../../toolkits/research/save-prospect.js";

export const saveProspectTool = defineLocalTool({
  ...saveProspectDefinition,
  async execute({ input, manager, workspaceId }) {
    const prospect: ProspectRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      company: input.company,
      source: input.source,
      sourceUrl: input.sourceUrl,
      summary: input.summary,
      evidence: input.evidence,
      outreachAngle: input.outreachAngle,
      relevance: input.relevance,
      status: input.status,
      foundAt: time(input.foundAt),
    };
    await manager.saveProspect(workspaceId, prospect);
    return jsonResponse({ prospect });
  },
});
