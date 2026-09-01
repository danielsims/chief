import type { ReactNode } from "react";
import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  VercelProjectOption,
  VercelTeamOption,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";

import { providerCredentialHelp } from "../lib/provider-credential-help";

type VercelCredentialKind = "account-access-token" | "ai-gateway-api-key";
type VercelConnectionFormState =
  | { kind: "collapsed" }
  | { kind: "editing"; credential: string; error: string | null }
  | { kind: "connecting"; credential: string };

export const VERCEL_CONNECTION_PROMPT = {
  description: "Connect this workspace before continuing.",
  title: "Connect Vercel",
} as const;

const credentialCopy = {
  "account-access-token": {
    connectedDescription: "Choose the team and project this agent will use.",
    connectedTitle: "AI Gateway key added",
    description:
      "Create a scoped token in Vercel and paste it once. Chief stores it encrypted on this workspace’s relay.",
    helpLabel: providerCredentialHelp["vercel-access-token"].label,
    helpUrl: providerCredentialHelp["vercel-access-token"].url,
    placeholder: "Vercel access token",
  },
  "ai-gateway-api-key": {
    connectedDescription: "Chief will use this key for hosted agent inference.",
    connectedTitle: "Vercel connected",
    description:
      "Create an AI Gateway key in Vercel and paste it once. Chief stores it encrypted on this workspace’s relay.",
    helpLabel: providerCredentialHelp["vercel-ai-gateway-key"].label,
    helpUrl: providerCredentialHelp["vercel-ai-gateway-key"].url,
    placeholder: "Vercel AI Gateway key",
  },
} satisfies Record<
  VercelCredentialKind,
  {
    connectedDescription: string;
    connectedTitle: string;
    description: string;
    helpLabel: string;
    helpUrl: string;
    placeholder: string;
  }
>;

export function VercelConnection({
  connected,
  credentialKind,
  disabled = false,
  expanded,
  onExpandedChange,
  onConnect,
}: {
  connected: boolean;
  credentialKind: VercelCredentialKind;
  disabled?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onConnect: (credential: string) => Promise<void> | void;
}) {
  const copy = credentialCopy[credentialKind];
  const [form, setForm] = useState<VercelConnectionFormState>({
    kind: "collapsed",
  });

  const formExpanded = connected
    ? false
    : (expanded ?? form.kind !== "collapsed");
  const visibleForm = !formExpanded
    ? null
    : form.kind === "collapsed"
      ? ({ kind: "editing", credential: "", error: null } satisfies Extract<
          VercelConnectionFormState,
          { kind: "editing" }
        >)
      : form;

  if (!visibleForm) {
    return (
      <div className="bg-background flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {connected ? copy.connectedTitle : VERCEL_CONNECTION_PROMPT.title}
          </p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-5">
            {connected
              ? copy.connectedDescription
              : VERCEL_CONNECTION_PROMPT.description}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setForm({ kind: "editing", credential: "", error: null });
            onExpandedChange?.(true);
          }}
        >
          {connected ? "Change" : "Connect"}
        </Button>
      </div>
    );
  }

  const connecting = visibleForm.kind === "connecting";

  return (
    <div className="bg-background space-y-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">{VERCEL_CONNECTION_PROMPT.title}</p>
        <p className="text-muted-foreground mt-1 text-[13px] leading-5">
          {copy.description}
        </p>
      </div>
      <Input
        autoComplete="off"
        className="bg-background"
        type="password"
        value={visibleForm.credential}
        placeholder={copy.placeholder}
        disabled={disabled || connecting}
        onChange={(event) =>
          setForm({
            kind: "editing",
            credential: event.target.value,
            error: null,
          })
        }
      />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground w-full text-left text-[13px] leading-5 underline-offset-4 hover:underline"
        onClick={() => void openExternalUrl(copy.helpUrl)}
      >
        {copy.helpLabel}
      </button>
      {visibleForm.kind === "editing" && visibleForm.error ? (
        <p className="text-destructive text-[13px]">{visibleForm.error}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={connecting}
          onClick={() => {
            setForm({ kind: "collapsed" });
            onExpandedChange?.(false);
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={disabled || connecting || !visibleForm.credential.trim()}
          onClick={() =>
            void connect({
              credential: visibleForm.credential,
              onConnect,
              onConnected: () => onExpandedChange?.(false),
              onStateChange: setForm,
            })
          }
        >
          {connecting ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}

export function VercelDestinationFields({
  loading,
  mode,
  projectId,
  projectName,
  projects,
  teamId,
  teams,
  onMode,
  onProject,
  onProjectName,
  onTeam,
}: {
  loading: boolean;
  mode: "" | "existing" | "new";
  projectId: string;
  projectName: string;
  projects: VercelProjectOption[];
  teamId: string;
  teams: VercelTeamOption[];
  onMode: (value: "" | "existing" | "new") => void;
  onProject: (value: string) => void;
  onProjectName: (value: string) => void;
  onTeam: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <VercelField label="Vercel team">
        <Select value={teamId} onValueChange={onTeam}>
          <SelectTrigger className="bg-background h-10">
            <SelectValue
              placeholder={loading ? "Loading teams…" : "Choose team"}
            />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name || team.slug}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </VercelField>
      <VercelField label="Project action">
        <Select
          value={mode}
          onValueChange={(value) => {
            if (value === "existing" || value === "new") onMode(value);
          }}
        >
          <SelectTrigger className="bg-background h-10">
            <SelectValue placeholder="Choose project action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Create a new project</SelectItem>
            <SelectItem value="existing">
              Deploy to an existing project
            </SelectItem>
          </SelectContent>
        </Select>
      </VercelField>
      <div className="sm:col-span-2">
        {mode === "new" ? (
          <VercelField label="New Vercel project name">
            <Input
              value={projectName}
              onChange={(event) => onProjectName(event.target.value)}
              placeholder="researcher-agent"
            />
          </VercelField>
        ) : mode === "existing" ? (
          <VercelField label="Vercel project">
            <Select
              value={projectId}
              disabled={!teamId || loading}
              onValueChange={onProject}
            >
              <SelectTrigger className="bg-background h-10">
                <SelectValue
                  placeholder={loading ? "Loading projects…" : "Choose project"}
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </VercelField>
        ) : null}
      </div>
    </div>
  );
}

function VercelField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[13px] font-medium">{label}</label>
      {children}
    </div>
  );
}

async function connect({
  credential,
  onConnect,
  onConnected,
  onStateChange,
}: {
  credential: string;
  onConnect: (credential: string) => Promise<void> | void;
  onConnected: () => void;
  onStateChange: (state: VercelConnectionFormState) => void;
}) {
  const trimmedCredential = credential.trim();
  onStateChange({ kind: "connecting", credential: trimmedCredential });
  try {
    await onConnect(trimmedCredential);
    onStateChange({ kind: "collapsed" });
    onConnected();
  } catch (error) {
    onStateChange({
      kind: "editing",
      credential: trimmedCredential,
      error:
        error instanceof Error
          ? error.message
          : "Chief could not connect this workspace to Vercel.",
    });
  }
}

async function openExternalUrl(url: string) {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
