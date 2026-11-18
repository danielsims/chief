import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  MessageSquare,
} from "lucide-react";

import type { GenerativeDraftData } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { insetBandClass, insetCardClass } from "../inset-card";

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 text-[13px]">
      <span className="text-muted-foreground w-16 shrink-0 text-[12px]">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

/**
 * An email or message an agent wrote for the person to send. They edit it in
 * place, then copy it or open it in their mail app. Nothing is sent from here.
 */
export function DraftCard({ data }: { data: GenerativeDraftData }) {
  const [body, setBody] = useState(data.body);
  const [copied, setCopied] = useState(false);
  const email = data.format === "email";
  const copy = () =>
    void navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  const openMail = () => {
    const query = new URLSearchParams();
    if (data.subject) query.set("subject", data.subject);
    query.set("body", body);
    void openUrl(
      `mailto:${encodeURIComponent(data.to ?? "")}?${query.toString().replace(/\+/gu, "%20")}`,
    );
  };
  const rows = Math.min(14, Math.max(3, body.split("\n").length + 1));
  return (
    <section
      aria-label={email ? "Email draft" : "Message draft"}
      className={`${insetBandClass} block w-full max-w-md text-left`}
    >
      <span className="text-muted-foreground flex h-7 items-center gap-1.5 px-2.5 text-[12px]">
        {email ? <FileText size={12} /> : <MessageSquare size={12} />}
        {email ? "Email draft" : "Message draft"}
      </span>
      <div className={insetCardClass}>
        {email && (data.to || data.subject) ? (
          <div className="border-border mb-2 border-b pb-1.5">
            {data.to ? <Field label="To">{data.to}</Field> : null}
            {data.subject ? (
              <Field label="Subject">{data.subject}</Field>
            ) : null}
          </div>
        ) : !email && data.to ? (
          <p className="text-muted-foreground mb-2 text-[12px]">{data.to}</p>
        ) : null}
        <textarea
          aria-label="Draft"
          value={body}
          rows={rows}
          onChange={(event) => setBody(event.target.value)}
          className="w-full resize-none bg-transparent text-[13px] leading-5 outline-none"
        />
      </div>
      <span className="flex min-h-9 items-center gap-1.5 px-2.5 pt-1 text-[12px]">
        <span className="flex-1" />
        {email ? (
          <Button size="xs" variant="outline" onClick={openMail}>
            Open in Mail <ArrowUpRight size={12} />
          </Button>
        ) : null}
        <Button
          size="xs"
          variant={email ? "outline" : "default"}
          onClick={copy}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </span>
    </section>
  );
}
