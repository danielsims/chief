export class RecoverableToolError extends Error {
  override readonly name = "RecoverableToolError";
}

export function isRecoverableToolError(
  error: Error,
): error is RecoverableToolError {
  return error instanceof RecoverableToolError;
}
