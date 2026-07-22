export const DEPLOYMENT_REQUIRED_MESSAGE =
  "Chief's cloud deployment is no longer available. Connect Chief to this Mac or deploy it again.";

export class DeploymentNotFoundError extends Error {
  readonly code = "deployment_not_found" as const;

  constructor(options?: ErrorOptions) {
    super(DEPLOYMENT_REQUIRED_MESSAGE, options);
    this.name = "DeploymentNotFoundError";
  }
}

export function isDeploymentNotFound(error: unknown, depth = 0): boolean {
  if (depth > 4 || error === null || error === undefined) return false;
  if (error instanceof DeploymentNotFoundError) return true;
  if (typeof error === "string") {
    return (
      error === DEPLOYMENT_REQUIRED_MESSAGE ||
      error.includes("DEPLOYMENT_NOT_FOUND")
    );
  }
  if (typeof error !== "object") return false;
  const value = error as {
    message?: unknown;
    status?: unknown;
    cause?: unknown;
  };
  if (
    typeof value.message === "string" &&
    (value.message === DEPLOYMENT_REQUIRED_MESSAGE ||
      value.message.includes("DEPLOYMENT_NOT_FOUND"))
  ) {
    return true;
  }
  return isDeploymentNotFound(value.cause, depth + 1);
}

export function safeRuntimeError(error: unknown) {
  if (isDeploymentNotFound(error)) return DEPLOYMENT_REQUIRED_MESSAGE;
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed query:|insert into|update .+ set|SQLITE_/i.test(message)) {
    return "Chief could not open this conversation. Refresh to try again.";
  }
  return message.slice(0, 1_000);
}
