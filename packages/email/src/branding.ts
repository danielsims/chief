export interface EmailBranding {
  applicationName: string;
  companyName?: string;
}

const DEFAULT_EMAIL_BRANDING: EmailBranding = {
  applicationName: "Chief",
};

export function getEmailBranding(): EmailBranding {
  return DEFAULT_EMAIL_BRANDING;
}
