import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Card, CardContent } from "@chief/ui/components/card";

import { CHIEF_CLOUD_RELAY_URL, RELAY_URL } from "../../lib/config";

export function ConnectionSettings() {
  const [copied, setCopied] = useState(false);
  const relayUrl = new URL(RELAY_URL).origin;
  const chiefHosted = relayUrl === new URL(CHIEF_CLOUD_RELAY_URL).origin;

  const copyRelayUrl = async () => {
    await navigator.clipboard.writeText(relayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <Card>
      <CardContent className="divide-y p-0">
        <ConnectionRow label="Relay address">
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-96 truncate">{relayUrl}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Copy relay address"
              onClick={() => void copyRelayUrl()}
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        </ConnectionRow>
        <ConnectionRow label="Hosting">
          <span>{chiefHosted ? "Chief Cloud" : "Self-hosted"}</span>
        </ConnectionRow>
        <ConnectionRow label="Identity">
          <span className="flex items-center gap-2">
            <ShieldCheck className="text-muted-foreground size-4" aria-hidden />
            Signed device
          </span>
        </ConnectionRow>
      </CardContent>
    </Card>
  );
}

function ConnectionRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 px-5 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
