import { HttpError } from "./http";
import { readTrustedContext } from "./internal-context";

/** Deletion is issued by the workspace lifecycle router after authorization. */
export function requireInternalDeletion(request: Request) {
  const context = readTrustedContext(request);
  if (request.method !== "POST" || context.principal.kind !== "user") {
    throw new HttpError(
      403,
      "internal_deletion_denied",
      "Deletion requires an authorized workspace lifecycle operation.",
    );
  }
  return context;
}
