import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import { readdirSync, rmSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

// Drop + recreate the app database, then wipe generated migration artifacts so
// the next `bun db:generate` produces a clean 0000 migration from current
// schema.ts. The bot's migrate() call rebuilds everything on next boot.

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  error("DATABASE_URL is required");
  process.exit(1);
}

// Connect to the cluster's bookkeeping db so we can drop the app db itself.
const adminUrl = dbUrl.replace(/\/[^/]+$/, "/postgres");
const sql = postgres(adminUrl, { onnotice: () => {} });

try {
  const dbName = dbUrl.split("/").pop()!;

  // Kick every open connection so DROP DATABASE doesn't trip on "in use".
  await sql`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${dbName}
    AND pid <> pg_backend_pid()
  `;

  await sql`DROP DATABASE IF EXISTS ${sql(dbName)}`;
  await sql`CREATE DATABASE ${sql(dbName)}`;
  log(`Database ${dbName} has been reset successfully.`);

  // Wipe generated migrations so the next db:generate emits a fresh 0000.
  const drizzleDir = resolve(import.meta.dirname, ".");
  for (const entry of readdirSync(drizzleDir)) {
    if (entry === "reset-db.ts") continue;
    rmSync(resolve(drizzleDir, entry), { recursive: true, force: true });
    log(`Removed: ${entry}`);
  }
} catch (err) {
  error("Error resetting database:", err);
  process.exit(1);
} finally {
  await sql.end();
}
