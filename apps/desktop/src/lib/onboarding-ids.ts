export function onboardingScopedId(workspaceId: string, suffix: string) {
  const workspace = workspaceId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `onboarding-${workspace || "workspace"}-${suffix}`.slice(0, 96);
}

export function onboardingLegacyId(id: string, workspaceId: string) {
  const prefix = onboardingScopedId(workspaceId, "").replace(/-$/, "");
  return id.startsWith(`${prefix}-`)
    ? `onboarding-${id.slice(prefix.length + 1)}`
    : id;
}
