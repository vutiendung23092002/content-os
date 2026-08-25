export type SupabaseIdentityClaims = {
  email?: string;
  sub: string;
};

export function toSupabaseIdentityClaims(
  claims: unknown,
): SupabaseIdentityClaims | null {
  if (!claims || typeof claims !== "object") return null;

  const record = claims as Record<string, unknown>;
  if (typeof record.sub !== "string" || !record.sub.trim()) return null;

  return {
    sub: record.sub,
    ...(typeof record.email === "string" && record.email.trim()
      ? { email: record.email }
      : {}),
  };
}
