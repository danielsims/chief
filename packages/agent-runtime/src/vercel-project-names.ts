const reservedVercelProjectNames = new Set([
  "chief",
  "chief-web",
  "heychief",
  "www",
]);

export function isReservedVercelProjectName(name: string) {
  return reservedVercelProjectNames.has(name.trim().toLowerCase());
}

export function vercelProjectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

export function suggestedVercelProjectName(
  workspaceName: string,
  existingProjectNames: readonly string[] = [],
) {
  const slug = vercelProjectSlug(workspaceName) || "workspace";
  return availableVercelProjectName(`${slug}-chief`, existingProjectNames);
}

export function preferredVercelProjectName(
  workspaceName: string,
  currentName = "",
) {
  const slug = vercelProjectSlug(workspaceName) || "workspace";
  const current = vercelProjectSlug(currentName);
  if (!current || isLegacyAutoEveName(current, slug)) return `${slug}-chief`;
  return current;
}

export function availableVercelProjectName(
  preferred: string,
  existingProjectNames: readonly string[] = [],
) {
  const taken = new Set(
    [...reservedVercelProjectNames, ...existingProjectNames].map((name) =>
      name.trim().toLowerCase(),
    ),
  );
  const requested = vercelProjectSlug(preferred) || "workspace-chief";
  const first = isReservedVercelProjectName(requested)
    ? `${requested}-chief`
    : requested;
  const stem = first.replace(/-\d+$/u, "") || first;
  const names = [
    first,
    ...Array.from({ length: 98 }, (_, index) => `${stem}-${index + 2}`),
  ];
  for (const candidate of names) {
    const name = candidate.slice(0, 64);
    if (!taken.has(name.toLowerCase()) && !isReservedVercelProjectName(name)) {
      return name;
    }
  }
  return `${stem.slice(0, 60)}-${Date.now().toString(36).slice(-4)}`.slice(
    0,
    64,
  );
}

function isLegacyAutoEveName(name: string, workspaceSlug: string) {
  return (
    name === `${workspaceSlug}-eve` ||
    name.startsWith(`${workspaceSlug}-eve-`) ||
    name === `${workspaceSlug}-chief-eve`
  );
}
