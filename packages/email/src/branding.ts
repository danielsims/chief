export interface EmailBranding {
  applicationName: string;
  companyName?: string;
}

export const DEFAULT_EMAIL_LOGO_URL =
  "https://heychief.sh/brand/chief-mark-sharp-open-white.png";

export const PREVIEW_EMAIL_LOGO_URL =
  "http://localhost:3001/static/chief-mark-sharp-open-white.png";

const DEFAULT_EMAIL_BRANDING: EmailBranding = {
  applicationName: "Chief",
};

export function getEmailBranding(): EmailBranding {
  return DEFAULT_EMAIL_BRANDING;
}
