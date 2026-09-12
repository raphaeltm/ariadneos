import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../server/auth";
const db = new DatabaseSync(":memory:");
const auth = createAuth({
  DB: db as unknown as D1Database,
  BETTER_AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "schema-generation-only-not-a-real-secret",
  SLACK_CLIENT_ID: "schema",
  SLACK_CLIENT_SECRET: "schema",
});
const migration = await getMigrations(auth.options);
writeFileSync(
  "migrations/0003_better_auth.sql",
  await migration.compileMigrations(),
);
db.close();
