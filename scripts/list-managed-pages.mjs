import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, code: "DATABASE_URL_MISSING" }));
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 2,
});

try {
  const pages = await sql`
    select
      external_page_id,
      name,
      category,
      remote_metadata -> 'tasks' as tasks
    from hancontent_os.pages
    where is_active = true
    order by name
  `;

  console.log(
    JSON.stringify(
      {
        ok: true,
        count: pages.length,
        pages: pages.map((page) => ({
          id: page.external_page_id,
          name: page.name,
          category: page.category,
          tasks: page.tasks ?? [],
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error?.code ?? error?.name ?? "PAGE_LIST_FAILED",
    }),
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 }).catch(() => undefined);
}
