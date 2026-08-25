const baseUrl = (
  process.env.FACEBOOK_CRON_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL
)?.replace(/\/$/, "");
const secret = process.env.FACEBOOK_CRON_SECRET;

if (!baseUrl) {
  throw new Error(
    "FACEBOOK_CRON_BASE_URL hoặc NEXT_PUBLIC_SITE_URL phải được cấu hình.",
  );
}
if (!secret || secret.length < 32) {
  throw new Error("FACEBOOK_CRON_SECRET phải có ít nhất 32 ký tự.");
}

const endpoints = ["/api/cron/sync-facebook", "/api/cron/reconcile-operations"];

let failed = false;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(4 * 60 * 1000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      failed = true;
      console.error(endpoint, response.status, payload?.error?.code ?? "ERROR");
      continue;
    }
    console.info(endpoint, payload?.result?.status ?? "completed");
  } catch (error) {
    failed = true;
    console.error(
      endpoint,
      error instanceof Error ? error.name : "REQUEST_FAILED",
    );
  }
}

if (failed) process.exitCode = 1;
