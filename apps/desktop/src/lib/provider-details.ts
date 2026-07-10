export const GOOGLE_ANALYTICS_PROVIDER = "google-analytics";

export function providerDetails(provider: string) {
  if (
    provider === GOOGLE_ANALYTICS_PROVIDER ||
    provider === "analytics.googleapis.com"
  ) {
    return {
      product: "Google Analytics",
      family: "Google",
      productDomain: "analytics.googleapis.com",
      familyDomain: "google.com",
    };
  }
  if (provider === "google-ads" || provider === "googleads.googleapis.com") {
    return {
      product: "Google Ads",
      family: "Google",
      productDomain: "googleads.googleapis.com",
      familyDomain: "google.com",
    };
  }
  if (provider === "meta" || provider === "facebook.com") {
    return {
      product: "Meta",
      family: "Meta",
      productDomain: "facebook.com",
      familyDomain: "facebook.com",
    };
  }
  return {
    product: provider,
    family: provider,
    productDomain: provider,
    familyDomain: provider,
  };
}
