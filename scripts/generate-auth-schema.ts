// Verifies the checked-in migrations still satisfy Better Auth's expected schema.
//
// 0003_better_auth.sql is already applied to the deployed databases, so it must
// not be regenerated in place: later schema additions belong in a new migration.
// This script therefore compares rather than overwrites, and names any column
// Better Auth expects that no migration creates.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../server/auth.ts";

const COLUMN_PATTERN = /"(\w+)"\s+(?:text|integer|date|real|blob)/gi;
const TABLE_PATTERN = /create table "(\w+)"\s*\(([^;]*)\)/gi;
const ADD_COLUMN_PATTERN =
  /alter\s+table\s+"?(\w+)"?\s+add\s+column\s+"?(\w+)"?/gi;

const db = new DatabaseSync(":memory:");
const auth = createAuth({
  BETTER_AUTH_SECRET: "schema-generation-only-not-a-real-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
  DB: db as unknown as D1Database,
  SLACK_CLIENT_ID: "schema",
  SLACK_CLIENT_SECRET: "schema",
});
const migration = await getMigrations(auth.options);
const expectedSql = await migration.compileMigrations();
db.close();

function columnsFromCreateStatements(sql: string) {
  const tables = new Map<string, Set<string>>();
  for (const [, table, body] of sql.matchAll(TABLE_PATTERN)) {
    if (!(table && body)) {
      continue;
    }
    const columns = new Set(
      [...body.matchAll(COLUMN_PATTERN)].map(([, column]) => column ?? "")
    );
    tables.set(table, columns);
  }
  return tables;
}

const expected = columnsFromCreateStatements(expectedSql);

const migrationsDir = join(import.meta.dirname, "..", "migrations");
const applied = new Map<string, Set<string>>();
for (const name of readdirSync(migrationsDir).sort()) {
  if (!name.endsWith(".sql")) {
    continue;
  }
  const sql = readFileSync(join(migrationsDir, name), "utf8");
  for (const [table, columns] of columnsFromCreateStatements(sql)) {
    const existing = applied.get(table) ?? new Set<string>();
    for (const column of columns) {
      existing.add(column);
    }
    applied.set(table, existing);
  }
  for (const [, table, column] of sql.matchAll(ADD_COLUMN_PATTERN)) {
    if (!(table && column)) {
      continue;
    }
    const existing = applied.get(table) ?? new Set<string>();
    existing.add(column);
    applied.set(table, existing);
  }
}

const missing: string[] = [];
for (const [table, columns] of expected) {
  const found = applied.get(table);
  if (!found) {
    missing.push(`table ${table}`);
    continue;
  }
  for (const column of columns) {
    if (!found.has(column)) {
      missing.push(`${table}.${column}`);
    }
  }
}

if (missing.length) {
  console.error(
    "Migrations do not create everything Better Auth expects:\n" +
      missing.map((item) => `  - ${item}`).join("\n") +
      "\nAdd a new migration with the missing columns. Do not edit an applied one."
  );
  process.exit(1);
}
console.log(
  `PASS: migrations satisfy the Better Auth schema (${expected.size} tables).`
);
