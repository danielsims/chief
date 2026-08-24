import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import { jsonObjectSchema, parseJsonObject } from "@chief/relay-contracts";

export const authUserInfoSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string(),
  email_verified: z.boolean().optional(),
  picture: z.string().nullable().optional(),
});

export interface AuthOrganization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: string | JsonObject | null;
}

export const authOrganizationSchema: z.ZodType<AuthOrganization> = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: z.string().nullable().optional(),
  metadata: z.union([z.string(), jsonObjectSchema, z.null()]).optional(),
});

const organizationListSchema = z.array(authOrganizationSchema);
const organizationEnvelopeSchema = z.object({
  organizations: organizationListSchema,
});
const organizationDataEnvelopeSchema = z.object({
  data: z.union([organizationListSchema, organizationEnvelopeSchema]),
});

export const organizationMemberSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.union([z.string(), z.array(z.string())]),
});

export const organizationCacheSchema = z.object({
  userId: z.string(),
  organizations: organizationListSchema,
  cachedAt: z.number(),
});

export function normalizeOrganizations<Input>(
  value: Input,
): AuthOrganization[] {
  const direct = organizationListSchema.safeParse(value);
  if (direct.success) return direct.data;
  const envelope = organizationEnvelopeSchema.safeParse(value);
  if (envelope.success) return envelope.data.organizations;
  const dataEnvelope = organizationDataEnvelopeSchema.safeParse(value);
  if (!dataEnvelope.success) return [];
  const data = dataEnvelope.data.data;
  return Array.isArray(data) ? data : data.organizations;
}

export function parseOrganizationMetadata(
  organization: AuthOrganization | undefined | null,
): JsonObject {
  const metadata = organization?.metadata;
  if (!metadata) return {};
  const direct = jsonObjectSchema.safeParse(metadata);
  if (direct.success) return direct.data;
  const serialized = z.string().safeParse(metadata);
  if (!serialized.success) return {};
  try {
    return parseJsonObject(JSON.parse(serialized.data)) ?? {};
  } catch {
    return {};
  }
}
