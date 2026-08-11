import { BookOpen } from "lucide-react";

const SKILL_LABELS: Record<string, string> = {
  "build-brand-profile": "Build brand profile",
  "find-buying-signals": "Find buying signals",
  "connect-google-analytics": "Connect Google Analytics",
  "setup-google-analytics": "Connect Google Analytics",
  "setup-github": "Setup GitHub",
  "setup-vercel": "Setup Vercel",
  "setup-integration": "Setup Integration",
};

export function messageSkill(text: string) {
  const id = /^\[chief-skill:([a-z0-9-]+)]$/im.exec(text)?.[1];
  return {
    id,
    label: id ? (SKILL_LABELS[id] ?? id) : undefined,
    inlineText: id
      ? text
          .replace(
            /^[ \t]*\[chief-skill:[a-z0-9-]+][ \t]*(?:\r?\n[ \t]*)*/im,
            `[chief-skill:${id}] `,
          )
          .trim()
      : text,
    visibleText: text
      .split("\n")
      .filter((line) => !/^\[chief-skill:[a-z0-9-]+]$/.test(line.trim()))
      .join("\n")
      .trim(),
  };
}

export function splitSkillReferences(text: string) {
  const segments: (
    | { type: "text"; value: string }
    | { type: "skill"; id: string; label: string }
  )[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[chief-skill:([a-z0-9-]+)\]/giu)) {
    if (match.index > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, match.index) });
    }
    const id = match[1] ?? "";
    segments.push({
      type: "skill",
      id,
      label: SKILL_LABELS[id] ?? id,
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }
  return segments.length > 0
    ? segments
    : [{ type: "text" as const, value: text }];
}

export function MessageSkillChip({
  id,
  label,
}: {
  id?: string;
  label: string;
}) {
  return (
    <span
      className="bg-foreground/[0.065] text-foreground mx-0.5 inline-flex min-h-[1.35em] items-center gap-1 rounded-md px-1.5 align-baseline text-[0.95em] leading-none font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_11%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_28%,transparent)]"
      data-skill-reference={id}
    >
      <BookOpen className="size-3" aria-hidden />
      <span>{label}</span>
    </span>
  );
}
