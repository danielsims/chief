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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";

import type { PluginOAuthClientInput } from "../../lib/runtime-plugins";
import type {
  OAuthClientSetupGuide,
  OAuthClientWizardStepId,
} from "./plugin-oauth-client-setup";
import { ProviderLogo } from "../provider-logo";
import {
  oauthClientCredentialError,
  oauthClientCredentialsAreComplete,
  oauthClientSetupGuide,
  oauthClientWizardSteps,
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
  const [step, setStep] = useState<OAuthClientWizardStepId>("register");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const guide = guideOverride ?? oauthClientSetupGuide(action);
  const wizard = oauthClientWizardSteps(guide);
  const current = wizard.find((item) => item.id === step) ?? wizard[0];
  const complete = oauthClientCredentialsAreComplete({
    guide,
    clientId,
    clientSecret,
  });
  const setupUrl = guide.setupUrl;

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
      <DialogContent className="max-h-[86vh] max-w-[480px] gap-0 overflow-y-auto rounded-2xl p-0">
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
          <ol
            className="mt-4 flex items-center gap-2 text-sm"
            aria-label="Setup steps"
          >
            {wizard.map((item, index) => {
              const active = item.id === step;
              return (
                <li key={item.id} className="flex min-w-0 items-center gap-2">
                  {index > 0 ? (
                    <span className="text-muted-foreground" aria-hidden>
                      /
                    </span>
                  ) : null}
                  <span
                    aria-current={active ? "step" : undefined}
                    className={
                      active
                        ? "font-medium"
                        : "text-muted-foreground font-medium"
                    }
                  >
                    {index + 1}. {item.title}
                  </span>
                </li>
              );
            })}
          </ol>
        </DialogHeader>
        <form
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "register") {
              setStep("credentials");
              return;
            }
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
          <div className="space-y-5 px-6 py-5">
            <p className="text-muted-foreground text-sm leading-5">
              {current?.description}
            </p>
            {step === "register" ? (
              <>
                {setupUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openUrl(setupUrl)}
                  >
                    <ExternalLink size={14} />
                    {guide.setupLinkLabel}
                  </Button>
                ) : null}
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">
                    {guide.callbackLabel}
                  </span>
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
              </>
            ) : (
              <>
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
                <div className="text-muted-foreground flex gap-2 text-sm leading-5">
                  <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                  <p>{guide.storageNotice}</p>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="border-t px-6 py-4">
            {step === "credentials" ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                onClick={() => setStep("register")}
              >
                Back
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {step === "register" ? (
                "Continue"
              ) : busy ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <Check size={14} />
              )}
              {step === "credentials" ? "Save and continue" : null}
            </Button>
          </DialogFooter>
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
        spellCheck={false}
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
