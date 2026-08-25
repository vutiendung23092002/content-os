import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "post-assets";

if (!projectUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const client = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const storage = client.storage.from(bucket);
const storageKey = `integration-tests/${randomUUID()}.png`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
let uploaded = false;

try {
  const { error: uploadError } = await storage.upload(storageKey, png, {
    contentType: "image/png",
    upsert: false,
  });
  if (uploadError) throw uploadError;
  uploaded = true;

  const { data: signedData, error: signedError } =
    await storage.createSignedUrl(storageKey, 60);
  if (signedError || !signedData?.signedUrl) {
    throw signedError ?? new Error("Signed URL was not returned.");
  }

  const signedResponse = await fetch(signedData.signedUrl, {
    cache: "no-store",
  });
  if (!signedResponse.ok) {
    throw new Error(`Signed URL returned HTTP ${signedResponse.status}.`);
  }
  const downloaded = Buffer.from(await signedResponse.arrayBuffer());
  if (!downloaded.equals(png)) {
    throw new Error("Downloaded object did not match the uploaded bytes.");
  }

  const publicUrl = storage.getPublicUrl(storageKey).data.publicUrl;
  const publicResponse = await fetch(publicUrl, { cache: "no-store" });
  if (publicResponse.ok) {
    throw new Error("The private bucket unexpectedly allowed public access.");
  }

  console.log(
    "Storage smoke passed: private upload and signed read are valid.",
  );
} finally {
  if (uploaded) {
    const { error: removeError } = await storage.remove([storageKey]);
    if (removeError) throw removeError;

    const { data: remaining, error: listError } = await storage.list(
      "integration-tests",
      { search: storageKey.split("/").at(-1) },
    );
    if (listError) throw listError;
    if (
      remaining.some((item) => `integration-tests/${item.name}` === storageKey)
    ) {
      throw new Error("Temporary storage object was not removed.");
    }
    console.log("Storage smoke cleanup passed.");
  }
}
