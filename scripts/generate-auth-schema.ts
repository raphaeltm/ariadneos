import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../server/auth.ts";

const db = new DatabaseSync(":memory:");
const auth = createAuth({
  BETTER_AUTH_SECRET: "schema-generation-only-not-a-real-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
  DB: db as unknown as D1Database,
  SLACK_CLIENT_ID: "schema",
  SLACK_CLIENT_SECRET: "schema",
});
const migration = await getMigrations(auth.options);
writeFileSync(
  "migrations/0003_better_auth.sql",
  await migration.compileMigrations()
);
db.close();
