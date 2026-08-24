import type { BetterAuthOptions, DBAdapter } from "better-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import {
  bearer,
  deviceAuthorization,
  jwt,
  organization,
} from "better-auth/plugins";

import type { ChiefAuthOptions } from "./options";
import { trustedOrigins } from "./origins";

const oauthScopes = ["openid", "profile", "email", "offline_access"] as const;

type ChiefDatabaseAdapter = (
  options: BetterAuthOptions,
) => DBAdapter<BetterAuthOptions>;

export function createChiefAuth(
  options: ChiefAuthOptions,
  database: ChiefDatabaseAdapter,
) {
  const google = options.google
    ? {
        google: {
          ...options.google,
          // When a browser sign-in is genuinely required, make the selected
          // Google identity explicit. A still-live Google browser session must
          // never silently choose between multiple Chief accounts.
          prompt: "select_account" as const,
        },
      }
    : {};
  const googleConfigured = Boolean(options.google);

  return betterAuth({
    appName: "Chief",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    database,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: googleConfigured,
    },
    socialProviders: google,
    trustedOrigins: trustedOrigins(options),
    advanced: {
      cookiePrefix: "chief_relay",
      useSecureCookies: true,
    },
    plugins: [
      bearer(),
      organization({
        allowUserToCreateOrganization: false,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        invitationLimit: 100,
        requireEmailVerificationOnInvitation: true,
        ...(options.sendOrganizationInvitation
          ? {
              sendInvitationEmail: async (invitation) => {
                await options.sendOrganizationInvitation?.({
                  email: invitation.email,
                  id: invitation.id,
                  inviter: {
                    email: invitation.inviter.user.email,
                    name: invitation.inviter.user.name,
                  },
                  organization: {
                    id: invitation.organization.id,
                    name: invitation.organization.name,
                  },
                  role: invitation.role,
                });
              },
            }
          : {}),
      }),
      jwt({
        jwt: {
          issuer: `${options.baseURL}/api/auth`,
          audience: options.baseURL,
          expirationTime: "15m",
        },
      }),
      oauthProvider({
        accessTokenExpiresIn: 15 * 60,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        codeExpiresIn: 5 * 60,
        loginPage: `${options.uiOrigin}/sign-in`,
        consentPage: `${options.uiOrigin}/consent`,
        scopes: [...oauthScopes],
        validAudiences: [options.baseURL],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        cachedTrustedClients: new Set(["chief-desktop", "chief-mobile"]),
        silenceWarnings: {
          oauthAuthServerConfig: true,
          openidConfig: true,
        },
        prefix: {
          opaqueAccessToken: "chief_at_",
          refreshToken: "chief_rt_",
          clientSecret: "chief_cs_",
        },
      }),
      deviceAuthorization({
        verificationUri: `${options.uiOrigin}/device`,
        expiresIn: "15 min",
        interval: "5 sec",
        userCodeLength: 8,
        validateClient: (clientId) => clientId === "chief-mobile",
      }),
    ],
  });
}
