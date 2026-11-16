export function workspaceRecoveryMessage(status?: number) {
  if (status === 401) {
    return "Sign in again to reconnect to this workspace.";
  }
  if (status === 403) {
    return "You don’t have access to this workspace.";
  }
  return "We couldn’t connect to this workspace.";
}
