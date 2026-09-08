import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

export interface OAuthClientSetupStep {
  title: string;
  description: string;
}

export interface OAuthClientCredentialField {
  id: "clientId" | "clientSecret";
  label: string;
  help: string;
  placeholder: string;
  required: boolean;
  requiredMessage: string;
}

export interface OAuthProviderFormField {
  label: string;
  guidance: string;
}

export interface OAuthClientSetupGuide {
  logoDomain: string;
  setupUrl?: string;
  setupLinkLabel?: string;
  documentationUrl?: string;
  summary: string;
  steps: readonly OAuthClientSetupStep[];
  providerFormFields?: readonly OAuthProviderFormField[];
  callbackLabel: string;
  callbackHelp: string;
  fields: readonly OAuthClientCredentialField[];
  configurationNotice?: string;
  storageNotice: string;
}

const clientIdField: OAuthClientCredentialField = {
  id: "clientId",
  label: "Client ID",
  help: "The public identifier issued by the provider.",
  placeholder: "Paste the client ID",
  required: true,
  requiredMessage: "Enter the client ID issued by the provider.",
};

const defaultFields: OAuthClientSetupGuide["fields"] = [
  clientIdField,
  {
    id: "clientSecret",
    label: "Client secret",
    help: "Leave this empty only when the provider identifies the app as a public client.",
    placeholder: "Paste the client secret",
    required: false,
    requiredMessage: "Enter the client secret issued by the provider.",
  },
];

const githubGuide: OAuthClientSetupGuide = {
  logoDomain: "github.com",
  setupUrl: "https://github.com/settings/apps/new",
  setupLinkLabel: "Create a GitHub App",
  documentationUrl:
    "https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app",
  summary:
    "Set up the GitHub App used by this workspace relay, then install it only on the repositories Chief should use.",
  steps: [
    {
      title: "Create a GitHub App",
      description:
        "Open GitHub's registration form, give this relay's app a recognizable name, and use https://heychief.sh as its homepage.",
    },
    {
      title: "Enable user authorization",
      description:
        "Paste Chief's callback URL and enable Request user authorization (OAuth) during installation.",
    },
    {
      title: "Install it on selected repositories",
      description:
        "After registration, install the app and choose only the repositories your workspace and agents should access.",
    },
    {
      title: "Copy the OAuth credentials",
      description:
        "Copy the app's Client ID and generate a client secret. Chief uses them to authorize the official remote GitHub MCP server without asking for a personal access token.",
    },
  ],
  providerFormFields: [
    {
      label: "GitHub App name",
      guidance: "A recognizable name, such as Chief – Acme Relay.",
    },
    {
      label: "Homepage URL",
      guidance: "https://heychief.sh",
    },
    {
      label: "Callback URL",
      guidance: "Use the callback URL shown below exactly as written.",
    },
    {
      label: "User authorization",
      guidance: "Enable OAuth authorization during installation.",
    },
  ],
  callbackLabel: "Callback URL",
  callbackHelp:
    "GitHub compares this value exactly during authorization. Copy it without changing the host, port, or path.",
  fields: [
    clientIdField,
    {
      id: "clientSecret",
      label: "Client secret",
      help: "Generate a client secret in the GitHub App's settings.",
      placeholder: "Paste the GitHub client secret",
      required: true,
      requiredMessage: "Generate and enter a GitHub client secret.",
    },
  ],
  configurationNotice:
    "This configures a customer-owned relay. Chief Cloud owns its GitHub App centrally, so people connecting a managed workspace should only install the app and choose repositories—never paste Chief's client secret.",
  storageNotice:
    "Chief encrypts these credentials in this workspace relay's private vault. Repository access remains limited by the GitHub App installation.",
};

function genericGuide(action: OAuthClientAction): OAuthClientSetupGuide {
  return {
    logoDomain: action.provider,
    setupUrl: action.setupUrl,
    setupLinkLabel: `Open ${action.pluginName} setup`,
    summary: `Register an OAuth app for this workspace relay with ${action.pluginName}, then add the credentials it gives you.`,
    steps: [
      {
        title: "Open the provider's developer settings",
        description: "Create a new OAuth application for this workspace relay.",
      },
      {
        title: "Add the callback URL",
        description:
          "Paste Chief's callback URL into the provider's callback or redirect URL field.",
      },
      {
        title: "Copy the credentials",
        description:
          "Copy the client ID and client secret issued by the provider, then paste them below.",
      },
    ],
    callbackLabel: "Callback URL",
    callbackHelp:
      "Paste this value exactly into the provider's callback or redirect URL field.",
    fields: defaultFields,
    storageNotice:
      "Chief encrypts these credentials in this workspace relay's private vault. Other workspaces cannot use them.",
  };
}

export function oauthClientSetupGuide(
  action: OAuthClientAction,
): OAuthClientSetupGuide {
  if (action.pluginId === "github" || action.provider === "GitHub") {
    return githubGuide;
  }
  return genericGuide(action);
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
