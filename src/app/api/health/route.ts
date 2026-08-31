import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    await getDatabase().execute(sql`select 1`);
    return NextResponse.json({
      status: "ok",
      service: "han-content-os",
      timestamp,
      dependencies: { database: "ok" },
    });
  } catch {
    return NextResponse.json(
      {
        status: "unavailable",
        service: "han-content-os",
        timestamp,
        dependencies: { database: "unavailable" },
      },
      { status: 503 },
    );
  }
}
