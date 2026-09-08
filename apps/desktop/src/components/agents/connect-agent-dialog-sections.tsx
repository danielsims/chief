import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import type { RelayClient } from "@chief/relay-client";
import type { RelayProject } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { DialogFooter } from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

export interface ConnectionResult {
  token: string;
  inboundUrl: string;
  agentId: string;
  deliverySigningKeyId: string;
  deliverySigningSecret: string;
}

export function ConnectionSetup({
  client,
  configuration,
  copied,
  error,
  result,
  saving,
  onClose,
  onConnected,
  onCopied,
  onError,
  onSaving,
}: {
  client: RelayClient | null;
  configuration: string;
  copied: boolean;
  error: string | null;
  result: ConnectionResult;
  saving: boolean;
  onClose: () => void;
  onConnected: () => Promise<void>;
  onCopied: (value: boolean) => void;
  onError: (value: string | null) => void;
  onSaving: (value: boolean) => void;
}) {
  return (
    <div className="space-y-4 overflow-y-auto px-6 py-6">
      <div className="bg-muted rounded-xl border p-4 font-mono text-xs whitespace-pre-wrap">
        {configuration}
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          await navigator.clipboard.writeText(configuration);
          onCopied(true);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy configuration"}
      </Button>
      <p className="text-muted-foreground text-[13px] leading-5">
        Chief could not update this Vercel project automatically. Add these
        variables to the deployment, redeploy it, then verify the connection.
      </p>
      {error ? <p className="text-destructive text-[13px]">{error}</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={!client || saving}
          onClick={async () => {
            if (!client) return;
            onSaving(true);
            onError(null);
            try {
              await client.externalAgents.verifyConnection(result.agentId);
              await onConnected();
              onClose();
            } catch (caught) {
              onError(
                caught instanceof Error
                  ? caught.message
                  : "Chief could not verify this Eve agent.",
              );
            } finally {
              onSaving(false);
            }
          }}
        >
          {saving ? "Verifying…" : "Verify connection"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function EveFields({
  endpoint,
  path,
  projectId,
  projects,
  refName,
  onEndpoint,
  onPath,
  onProject,
  onRef,
}: {
  endpoint: string;
  path: string;
  projectId: string;
  projects: RelayProject[];
  refName: string;
  onEndpoint: (value: string) => void;
  onPath: (value: string) => void;
  onProject: (value: string) => void;
  onRef: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <Field label="Vercel deployment URL">
        <Input
          value={endpoint}
          onChange={(event) => onEndpoint(event.target.value)}
          placeholder="https://my-agent.vercel.app/channels/chief/messages"
        />
      </Field>
      <Field label="Project">
        <Select value={projectId} onValueChange={onProject}>
          <SelectTrigger className="bg-background h-10">
            <SelectValue placeholder="Choose project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Definition path">
          <Input
            value={path}
            onChange={(event) => onPath(event.target.value)}
          />
        </Field>
        <Field label="Git ref">
          <Input
            value={refName}
            onChange={(event) => onRef(event.target.value)}
          />
        </Field>
      </div>
      {projects.length === 0 ? (
        <p className="text-destructive text-[13px]">
          Add a project before connecting a Vercel Eve agent.
        </p>
      ) : null}
    </div>
  );
}

export function ChoiceGrid({
  items,
  onToggle,
}: {
  items: { id: string; label: string; selected: boolean }[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            "flex items-center rounded-xl border px-4 py-3 text-left text-sm",
            item.selected && "border-foreground bg-muted",
          )}
          onClick={() => onToggle(item.id)}
        >
          <span>{item.label}</span>
          <span
            className={cn(
              "ml-auto flex size-4 items-center justify-center rounded border",
              item.selected && "bg-foreground text-background",
            )}
          >
            {item.selected ? <Check size={11} /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Section({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-muted-foreground mt-1 text-[13px] leading-5">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

export function Field({
  children,
  label,
  optional,
}: {
  children: ReactNode;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[13px] font-medium">
        {label}
        {optional ? (
          <span className="text-muted-foreground font-normal"> · Optional</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}
