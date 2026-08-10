import { useMemo, useState } from "react";
import { KeyRound, LockKeyhole, Search, Trash2 } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";

import { useWorkspaceEnvironmentVariables } from "../../lib/runtime";

const ENV_KEY = /^[A-Z][A-Z0-9_]{0,127}$/;

function VariableDialog({
  open,
  variableKey,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  variableKey: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (key: string, value: string) => void;
}) {
  const [key, setKey] = useState(variableKey ?? "");
  const [value, setValue] = useState("");

  const submit = () => {
    const normalizedKey = key.trim().toUpperCase();
    if (!ENV_KEY.test(normalizedKey) || !value) return;
    onSave(normalizedKey, value);
    setKey("");
    setValue("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setKey(variableKey ?? "");
          setValue("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {variableKey
              ? "Replace environment variable"
              : "Add environment variable"}
          </DialogTitle>
          <DialogDescription>
            Stored in this workspace's protected credential vault. Values are
            never returned to the interface or added to agent transcripts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs">Name</span>
            <Input
              value={key}
              disabled={Boolean(variableKey)}
              onChange={(event) =>
                setKey(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                )
              }
              placeholder="API_TOKEN"
              className="font-mono"
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs">Value</span>
            <Input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={
                variableKey ? "Enter a replacement value" : "Enter a value"
              }
              autoComplete="new-password"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!ENV_KEY.test(key.trim().toUpperCase()) || !value}
          >
            {variableKey ? "Replace" : "Add variable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EnvironmentSettings() {
  const { variables, error, refresh, save, remove, connected } =
    useWorkspaceEnvironmentVariables();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (variables ?? []).filter(
      (variable) =>
        !normalized || variable.key.toLowerCase().includes(normalized),
    );
  }, [query, variables]);

  const openAdd = () => {
    setEditingKey(null);
    setDialogOpen(true);
  };

  const openEdit = (key: string) => {
    setEditingKey(key);
    setDialogOpen(true);
  };

  return (
    <section>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-sm font-medium">Environment variables</h2>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm leading-6">
            Credentials and configuration available to agents in this workspace.
            Values requested by an agent appear here automatically.
          </p>
        </div>
        <Button onClick={openAdd} disabled={!connected}>
          Add environment variable
        </Button>
      </div>

      <div className="relative mt-6">
        <Search
          size={15}
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search variables"
          className="pl-9"
        />
      </div>

      <div className="mt-3 divide-y border">
        {error ? (
          <div className="flex min-h-36 flex-col items-center justify-center px-6 text-center">
            <KeyRound size={20} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">
              The local vault did not respond
            </p>
            <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-5">
              Your values remain protected. Chief will retry without exposing or
              replacing anything.
            </p>
            <Button className="mt-4" variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : variables === null ? (
          <div className="text-muted-foreground p-5 text-sm">
            {connected
              ? "Loading variables…"
              : "Connecting to the local vault…"}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-36 flex-col items-center justify-center px-6 text-center">
            <KeyRound size={20} strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium">
              {query ? "No matching variables" : "No environment variables yet"}
            </p>
            {!query ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Variables supplied during integration setup will appear here.
              </p>
            ) : null}
          </div>
        ) : (
          filtered.map((variable) => (
            <div
              key={variable.key}
              className="hover:bg-accent/30 flex min-h-20 items-center gap-4 px-4 transition-colors"
            >
              <span className="flex size-8 shrink-0 items-center justify-center border">
                <LockKeyhole size={14} className="text-muted-foreground" />
              </span>
              <button
                type="button"
                onClick={() => openEdit(variable.key)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate font-mono text-xs font-medium">
                  {variable.key}
                </span>
                <span className="text-muted-foreground mt-1 block font-mono text-xs tracking-widest">
                  ••••••••••••
                </span>
              </button>
              <span className="text-muted-foreground border px-2 py-1 text-[10px]">
                Sensitive
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${variable.key}`}
                onClick={() => setDeletingKey(variable.key)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))
        )}
      </div>

      <p className="text-muted-foreground mt-3 text-xs leading-5">
        Chief injects these only into local agent processes for this workspace.
        Secret values stay in the system credential store.
      </p>

      <VariableDialog
        key={`${editingKey ?? "new"}-${dialogOpen ? "open" : "closed"}`}
        open={dialogOpen}
        variableKey={editingKey}
        onOpenChange={setDialogOpen}
        onSave={save}
      />

      <Dialog
        open={Boolean(deletingKey)}
        onOpenChange={(open) => !open && setDeletingKey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete environment variable?</DialogTitle>
            <DialogDescription>
              Agents and integrations in this workspace will no longer receive
              {deletingKey ? ` ${deletingKey}` : " this variable"}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingKey(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingKey) remove(deletingKey);
                setDeletingKey(null);
              }}
            >
              Delete variable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
