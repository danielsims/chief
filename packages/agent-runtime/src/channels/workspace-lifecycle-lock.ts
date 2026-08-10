export class WorkspaceLifecycleLock {
  private readonly mutations = new Map<string, Promise<void>>();

  run<T>(workspaceId: string, mutation: () => Promise<T>) {
    const previous = this.mutations.get(workspaceId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(mutation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.mutations.set(workspaceId, settled);
    return result.finally(() => {
      if (this.mutations.get(workspaceId) === settled) {
        this.mutations.delete(workspaceId);
      }
    });
  }
}
