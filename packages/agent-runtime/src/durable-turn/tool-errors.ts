export class RecoverableToolError extends Error {
  override readonly name = "RecoverableToolError";
}

export class DeferredToolError extends Error {
  override readonly name = "DeferredToolError";

  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}

export function isRecoverableToolError(
  error: Error,
): error is RecoverableToolError {
  return error instanceof RecoverableToolError;
}

export function isDeferredToolError(error: Error): error is DeferredToolError {
  return error instanceof DeferredToolError;
}
