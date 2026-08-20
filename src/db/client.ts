import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireServerEnv } from "@/lib/env/server";
import * as schema from "./schema";

let queryClient: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseExecutor = Pick<
  AppDatabase,
  "delete" | "insert" | "select" | "update"
>;

export function getDatabase() {
  if (!queryClient) {
    queryClient = postgres(requireServerEnv("DATABASE_URL"), {
      max: 5,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }

  database ??= drizzle(queryClient, { schema });
  return database;
}

export async function runInTransaction<Result>(
  work: (transaction: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return getDatabase().transaction(async (transaction) => work(transaction));
}

export async function closeDatabase() {
  await queryClient?.end({ timeout: 5 });
  queryClient = undefined;
  database = undefined;
}
