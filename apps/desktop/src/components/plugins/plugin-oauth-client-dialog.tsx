import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  Copy,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { toast } from "sonner";

import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";

import type { PluginOAuthClientInput } from "../../lib/runtime-plugins";
import type { OAuthClientSetupGuide } from "./plugin-oauth-client-setup";
import { ProviderLogo } from "../provider-logo";
import {
  oauthClientCredentialError,
  oauthClientCredentialsAreComplete,
  oauthClientSetupGuide,
} from "./plugin-oauth-client-setup";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

export function PluginOAuthClientDialog({
  action,
  busy,
  guide: guideOverride,
  onClose,
  onSubmit,
}: {
  action: OAuthClientAction;
  busy: boolean;
  guide?: OAuthClientSetupGuide;
  onClose: () => void;
  onSubmit: (input: PluginOAuthClientInput) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const guide = guideOverride ?? oauthClientSetupGuide(action);
  const complete = oauthClientCredentialsAreComplete({
    guide,
    clientId,
    clientSecret,
  });
  const setupUrl = guide.setupUrl;
  const documentationUrl = guide.documentationUrl;

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(action.callbackUrl);
      toast.success("Callback URL copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[86vh] max-w-[620px] gap-0 overflow-y-auto rounded-2xl p-0">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <div className="flex items-center gap-3">
            <ProviderLogo
              domain={guide.logoDomain}
              label={action.pluginName}
              className="size-10 rounded-xl"
            />
            <div className="min-w-0">
              <DialogTitle>Connect {action.pluginName}</DialogTitle>
              <DialogDescription className="mt-1 leading-5">
                {guide.summary}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form
          className="space-y-6 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            const normalizedId = clientId.trim();
            const normalizedSecret = clientSecret.trim();
            if (!complete) return;
            void onSubmit({
              serverName: action.serverName,
              clientId: normalizedId,
              ...(normalizedSecret
                ? { clientSecret: normalizedSecret }
                : undefined),
            });
          }}
        >
          <section aria-labelledby="oauth-setup-heading">
            <div className="flex items-center justify-between gap-4">
              <h3 id="oauth-setup-heading" className="text-sm font-medium">
                Set up the OAuth app
              </h3>
              {setupUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void openUrl(setupUrl)}
                >
                  <ExternalLink size={14} />
                  {guide.setupLinkLabel}
                </Button>
              ) : null}
            </div>
            <ol className="mt-4 space-y-4">
              {guide.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="border-border bg-secondary flex size-6 shrink-0 items-center justify-center rounded-full border text-sm font-medium">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="text-muted-foreground mt-0.5 text-sm leading-5">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {guide.providerFormFields ? (
              <dl className="mt-5 divide-y border-y">
                {guide.providerFormFields.map((field) => (
                  <div
                    key={field.label}
                    className="grid grid-cols-[180px_1fr] gap-4 py-3 text-sm"
                  >
                    <dt className="font-medium">{field.label}</dt>
                    <dd className="text-muted-foreground leading-5">
                      {field.guidance}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="mt-4 space-y-1.5">
              <span className="text-sm font-medium">{guide.callbackLabel}</span>
              <span className="flex gap-2">
                <Input
                  value={action.callbackUrl}
                  readOnly
                  aria-label="Callback URL"
                  className="font-mono text-sm"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Copy callback URL"
                  onClick={() => void copyCallback()}
                >
                  <Copy size={15} />
                  Copy
                </Button>
              </span>
              <p className="text-muted-foreground text-sm leading-5">
                {guide.callbackHelp}
              </p>
            </div>
            {documentationUrl ? (
              <Button
                type="button"
                variant="link"
                className="mt-2 h-auto p-0"
                onClick={() => void openUrl(documentationUrl)}
              >
                Read {action.pluginName}&apos;s OAuth app guide
                <ExternalLink size={13} />
              </Button>
            ) : null}
          </section>

          <section
            className="space-y-4 border-t pt-5"
            aria-labelledby="oauth-credentials-heading"
          >
            <h3 id="oauth-credentials-heading" className="text-sm font-medium">
              Add the credentials
            </h3>
            {guide.configurationNotice ? (
              <p className="border-border bg-secondary/50 text-muted-foreground rounded-xl border px-4 py-3 text-sm leading-5">
                {guide.configurationNotice}
              </p>
            ) : null}
            {guide.fields.map((field) => (
              <CredentialField
                key={field.id}
                field={field}
                value={field.id === "clientId" ? clientId : clientSecret}
                error={
                  submitted
                    ? oauthClientCredentialError({
                        guide,
                        fieldId: field.id,
                        clientId,
                        clientSecret,
                      })
                    : undefined
                }
                onChange={
                  field.id === "clientId" ? setClientId : setClientSecret
                }
              />
            ))}
          </section>

          <div className="text-muted-foreground flex gap-2 border-t pt-4 text-sm leading-5">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" />
            <p>{guide.storageNotice}</p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <Check size={14} />
              )}
              Save and continue
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialField({
  field,
  value,
  error,
  onChange,
}: {
  field: OAuthClientSetupGuide["fields"][number];
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const descriptionId = `${field.id}-description`;
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium">
        {field.label}
        {!field.required ? (
          <span className="text-muted-foreground font-normal"> optional</span>
        ) : null}
      </span>
      <Input
        type={field.id === "clientSecret" ? "password" : "text"}
        value={value}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={field.id === "clientSecret" ? "new-password" : "off"}
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        className={error ? "border-destructive" : undefined}
      />
      <span
        id={descriptionId}
        className={
          error
            ? "text-destructive block text-sm leading-5"
            : "text-muted-foreground block text-sm leading-5"
        }
      >
        {error ?? field.help}
      </span>
    </label>
  );
}
