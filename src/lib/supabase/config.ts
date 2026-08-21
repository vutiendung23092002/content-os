const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function hasSupabasePublicConfig(): boolean {
  return Boolean(publicUrl && publishableKey);
}

export function getSupabasePublicConfig() {
  if (!publicUrl || !publishableKey) {
    throw new Error(
      "Supabase Auth chưa được cấu hình. Cần NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return { url: publicUrl, publishableKey };
}
