export interface EmailBranding {
  applicationName: string;
  companyName?: string;
}

export const DEFAULT_EMAIL_LOGO_URL =
  "https://heychief.sh/brand/chief-mark-white.png";

// Relative, so it resolves against whichever port the preview server is on.
export const PREVIEW_EMAIL_LOGO_URL = "/static/chief-mark-white.png";

const DEFAULT_EMAIL_BRANDING: EmailBranding = {
  applicationName: "Chief",
};

export function getEmailBranding(): EmailBranding {
  return DEFAULT_EMAIL_BRANDING;
}
