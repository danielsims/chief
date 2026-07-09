import { defineSchema } from "convex/server";

import { tables } from "./generatedSchema";

export { tables };

// Extend the generated tables with custom indexes here — generatedSchema.ts
// is overwritten on regeneration. Custom fields belong in the Better Auth
// options (additionalFields) so the generator emits them.
export default defineSchema({
  ...tables,
});
