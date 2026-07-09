import { createAuth } from "../auth";

// Export a static instance for Better Auth schema generation
// This file should only have the auth export - no other code
export const auth = createAuth(
  {} as unknown as Parameters<typeof createAuth>[0],
);
