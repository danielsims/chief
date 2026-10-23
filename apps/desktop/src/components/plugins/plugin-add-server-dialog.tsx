import { useState } from "react";
import { Plus, X } from "lucide-react";

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
import { cn } from "@chief/ui/lib/utils";

import { useRelaySession } from "../../lib/relay-session";

type AuthKind = "oauth" | "headers" | "none";

const authOptions: { value: AuthKind; label: string }[] = [
  { value: "oauth", label: "Sign in" },
  { value: "headers", label: "API key" },
  { value: "none", label: "None" },
];

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/u, "");
}

function httpsUrl(value: string) {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

/** Connects any remote MCP server by address; the relay checks and stores it. */
export function PluginAddServerDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (pluginId: string, auth: AuthKind) => void;
}) {
  const { client } = useRelaySession();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<AuthKind>("oauth");
  const [headers, setHeaders] = useState([
    { name: "Authorization", value: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = slug(name);
  const ready =
    Boolean(id) &&
    httpsUrl(url) &&
    (auth !== "headers" ||
      headers.every((header) => header.name.trim() && header.value.trim()));

  const reset = () => {
    setName("");
    setUrl("");
    setAuth("oauth");
    setHeaders([{ name: "Authorization", value: "" }]);
    setError("");
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const submit = async () => {
    if (!client || !ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const target = new URL(url.trim());
      await client.plugins.create({
        id,
        name: name.trim(),
        description: "",
        url: target.toString(),
        domain: target.hostname,
        auth:
          auth === "headers"
            ? {
                kind: "headers",
                headers: headers.map((header) => ({
                  name: header.name.trim(),
                  value: header.value.trim(),
                })),
              }
            : { kind: auth },
      });
      reset();
      onAdded(id, auth);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't add this server.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[440px] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="space-y-1 px-6 pt-6 pb-4 text-left">
          <DialogTitle className="text-[17px] leading-6 font-semibold tracking-[-0.02em]">
            Add MCP server
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            Connect any remote MCP server your agents should use.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 px-6 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme CRM"
              className="h-9 text-sm"
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Server URL</span>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://mcp.example.com/mcp"
              inputMode="url"
              className="h-9 font-mono text-[13px]"
            />
            {url && !httpsUrl(url) ? (
              <span className="text-destructive block text-[11px]">
                Use an https:// address.
              </span>
            ) : null}
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium">Authentication</span>
            <div className="bg-muted/45 flex rounded-lg p-0.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
              {authOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAuth(option.value)}
                  className={cn(
                    "text-muted-foreground hover:text-foreground flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-[background-color,box-shadow,color]",
                    auth === option.value &&
                      "bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.07),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {auth === "headers" ? (
            <div className="space-y-2">
              {headers.map((header, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={header.name}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((item, at) =>
                          at === index
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                    placeholder="Header"
                    aria-label="Header name"
                    className="h-9 w-36 shrink-0 font-mono text-[12px]"
                  />
                  <Input
                    type="password"
                    value={header.value}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((item, at) =>
                          at === index
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      )
                    }
                    placeholder={
                      header.name.toLowerCase() === "authorization"
                        ? "Bearer …"
                        : "Value"
                    }
                    aria-label="Header value"
                    className="h-9 min-w-0 flex-1 font-mono text-[12px]"
                  />
                  {headers.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove header"
                      className="h-9"
                      onClick={() =>
                        setHeaders((current) =>
                          current.filter((_, at) => at !== index),
                        )
                      }
                    >
                      <X size={14} />
                    </Button>
                  ) : null}
                </div>
              ))}
              {headers.length < 8 ? (
                <button
                  type="button"
                  onClick={() =>
                    setHeaders((current) => [
                      ...current,
                      { name: "", value: "" },
                    ])
                  }
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[11px] font-medium transition-colors"
                >
                  <Plus size={12} /> Add header
                </button>
              ) : null}
              <p className="text-muted-foreground text-[11px] leading-4">
                Stored encrypted in your workspace. Agents never see it.
              </p>
            </div>
          ) : null}
          {error ? (
            <p className="text-destructive text-xs leading-5">{error}</p>
          ) : null}
        </form>
        <DialogFooter className="border-border/60 items-center border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md text-xs"
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="rounded-md text-xs"
            disabled={!ready || busy || !client}
            onClick={() => void submit()}
          >
            {busy ? "Adding…" : "Add server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
