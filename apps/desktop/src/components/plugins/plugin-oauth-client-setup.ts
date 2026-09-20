import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

export type OAuthClientWizardStepId = "register" | "credentials";

export interface OAuthClientCredentialField {
  id: "clientId" | "clientSecret";
  label: string;
  help: string;
  placeholder: string;
  required: boolean;
  requiredMessage: string;
}

export interface OAuthClientWizardStep {
  id: OAuthClientWizardStepId;
  title: string;
  description: string;
}

export interface OAuthClientSetupGuide {
  logoDomain: string;
  setupUrl?: string;
  setupLinkLabel?: string;
  summary: string;
  registerDescription: string;
  credentialsDescription: string;
  callbackLabel: string;
  callbackHelp: string;
  fields: readonly OAuthClientCredentialField[];
  storageNotice: string;
}

const fields: OAuthClientSetupGuide["fields"] = [
  {
    id: "clientId",
    label: "Client ID",
    help: "The public identifier issued by the provider.",
    placeholder: "Paste the client ID",
    required: true,
    requiredMessage: "Enter the client ID issued by the provider.",
  },
  {
    id: "clientSecret",
    label: "Client secret",
    help: "Leave this empty only when the provider identifies the app as a public client.",
    placeholder: "Paste the client secret",
    required: false,
    requiredMessage: "Enter the client secret issued by the provider.",
  },
];

export function oauthClientSetupGuide(
  action: OAuthClientAction,
): OAuthClientSetupGuide {
  return {
    logoDomain: providerLogoDomain(action),
    setupUrl: action.setupUrl,
    setupLinkLabel: action.setupUrl ? `Open ${action.pluginName}` : undefined,
    summary: `Register an OAuth app with ${action.pluginName}, then paste the credentials it gives you.`,
    registerDescription:
      "Create an OAuth app in the provider’s developer settings and paste Chief’s callback URL as the redirect URL.",
    credentialsDescription:
      "Paste the client ID and client secret issued for this workspace.",
    callbackLabel: "Callback URL",
    callbackHelp:
      "Paste this value exactly into the provider’s callback or redirect URL field.",
    fields,
    storageNotice:
      "Chief encrypts these credentials in this workspace. Other workspaces cannot use them.",
  };
}

export function oauthClientWizardSteps(
  guide: OAuthClientSetupGuide,
): readonly OAuthClientWizardStep[] {
  return [
    {
      id: "register",
      title: "Set up the app",
      description: guide.registerDescription,
    },
    {
      id: "credentials",
      title: "Add credentials",
      description: guide.credentialsDescription,
    },
  ];
}

export function oauthClientCredentialsAreComplete({
  guide,
  clientId,
  clientSecret,
}: {
  guide: OAuthClientSetupGuide;
  clientId: string;
  clientSecret: string;
}) {
  const values = { clientId, clientSecret };
  return guide.fields.every(
    (field) => !field.required || values[field.id].trim().length > 0,
  );
}

export function oauthClientCredentialError({
  guide,
  fieldId,
  clientId,
  clientSecret,
}: {
  guide: OAuthClientSetupGuide;
  fieldId: OAuthClientCredentialField["id"];
  clientId: string;
  clientSecret: string;
}) {
  const field = guide.fields.find((candidate) => candidate.id === fieldId);
  if (!field?.required) return undefined;
  const values = { clientId, clientSecret };
  return values[fieldId].trim() ? undefined : field.requiredMessage;
}

function providerLogoDomain(action: OAuthClientAction) {
  if (action.provider.includes(".")) return action.provider;
  return action.pluginId;
}
