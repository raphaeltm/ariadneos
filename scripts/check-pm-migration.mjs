import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const migrationDir = resolve(repoRoot, "migrations");
const wrangler = resolve(repoRoot, "node_modules/.bin/wrangler");

function readConfig(migrationsDir) {
  const raw = execFileSync(
    process.execPath,
    ["scripts/read-wrangler-config.mjs"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  const config = JSON.parse(raw);
  config.routes = [];
  config.env = undefined;
  config.d1_databases[0].migrations_dir = migrationsDir;
  return config;
}

function run(args, cwd = repoRoot) {
  execFileSync(args[0], args.slice(1), {
    cwd,
    env: sanitizedEnv(),
    stdio: "pipe",
  });
}

function executeJson(configPath, persistDir, sql) {
  const output = execFileSync(
    wrangler,
    [
      "--config",
      configPath,
      "d1",
      "execute",
      "ariadneos-demo",
      "--local",
      "--persist-to",
      persistDir,
      "--command",
      sql,
      "--json",
    ],
    { cwd: repoRoot, encoding: "utf8", env: sanitizedEnv() }
  );
  const parsed = JSON.parse(output);
  if (!(Array.isArray(parsed) && parsed[0]?.success)) {
    throw new Error(`D1 command failed: ${output}`);
  }
  return parsed[0].results;
}

function applyMigrations(configPath, persistDir) {
  run([
    wrangler,
    "--config",
    configPath,
    "d1",
    "migrations",
    "apply",
    "ariadneos-demo",
    "--local",
    "--persist-to",
    persistDir,
  ]);
}

function sanitizedEnv() {
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(
        ([key]) => !(key.startsWith("CLOUDFLARE_") || key.startsWith("CF_"))
      )
      .concat([["WRANGLER_SEND_METRICS", "false"]])
  );
}

function setupConfig(directory, migrationsDir = migrationDir) {
  const configPath = join(directory, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(readConfig(migrationsDir)));
  return configPath;
}

function countRows(configPath, persistDir, tableName) {
  const rows = executeJson(
    configPath,
    persistDir,
    `SELECT COUNT(*) AS count FROM ${tableName};`
  );
  return Number(rows[0]?.count ?? 0);
}

function assertPmTables(configPath, persistDir) {
  const rows = executeJson(
    configPath,
    persistDir,
    "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pm_%' ORDER BY name;"
  );
  const tableNames = rows.map((row) => row.name);
  for (const required of [
    "pm_agent_message",
    "pm_agent_thread",
    "pm_activity",
    "pm_graph_revision",
    "pm_graph_view",
    "pm_kb_nodes",
    "pm_kb_state",
    "pm_kb_workflow_activities",
    "pm_kb_workflow_follows",
    "pm_message",
    "pm_step",
    "pm_step_evidence",
    "pm_journal",
  ]) {
    if (!tableNames.includes(required)) {
      throw new Error(`Missing ${required} after pm foundation migration`);
    }
  }
}

function smokeFresh() {
  const directory = mkdtempSync(join(tmpdir(), "ariadneos-pm-fresh-"));
  try {
    const configPath = setupConfig(directory);
    applyMigrations(configPath, directory);
    assertPmTables(configPath, directory);
    if (countRows(configPath, directory, "events") === 0) {
      throw new Error("Fresh migration lost seeded demo events");
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function smokeExisting() {
  const directory = mkdtempSync(join(tmpdir(), "ariadneos-pm-existing-"));
  try {
    const oldMigrationDir = join(directory, "old-migrations");
    mkdirSync(oldMigrationDir);
    for (const migrationName of [
      "0001_initial.sql",
      "0002_seed.sql",
      "0003_better_auth.sql",
      "0004_slack_message_events.sql",
    ]) {
      copyFileSync(
        join(migrationDir, migrationName),
        join(oldMigrationDir, migrationName)
      );
    }
    const oldConfigDir = join(directory, "old");
    mkdirSync(oldConfigDir);
    const oldConfigPath = setupConfig(oldConfigDir, oldMigrationDir);
    applyMigrations(oldConfigPath, directory);
    executeJson(
      oldConfigPath,
      directory,
      `INSERT INTO auth_user(
         id,
         name,
         email,
         emailVerified,
         image,
         createdAt,
         updatedAt
       )
       VALUES (
         'auth_synthetic',
         'Synthetic User',
         'synthetic.user@example.invalid',
         1,
         NULL,
         '2026-09-12T12:00:00.000Z',
         '2026-09-12T12:00:00.000Z'
       );
       INSERT INTO slack_message_events(
         team_id,
         event_id,
         channel_id,
         message_ts,
         event_ts,
         subtype,
         user_id,
         text,
         payload,
         received_at
       )
       VALUES (
         'T_SYNTH_FIXTURE',
         'Ev_SYNTH',
         'C_SYNTH_PROCESS',
         '100100.000400',
         '100100.000400',
         NULL,
         'U_SYNTH_FIXTURE',
         'synthetic process observation',
         '{}',
         1789214400000
       );
       INSERT INTO sessions(id, runs, created_at)
       VALUES ('existing-demo-session', 2, 1789214400000);`
    );
    const configPath = setupConfig(directory);
    applyMigrations(configPath, directory);
    assertPmTables(configPath, directory);
    const existingCounts = {
      auth: countRows(configPath, directory, "auth_user"),
      events: countRows(configPath, directory, "events"),
      sessions: countRows(configPath, directory, "sessions"),
      slack: countRows(configPath, directory, "slack_message_events"),
    };
    if (
      existingCounts.auth !== 1 ||
      existingCounts.slack !== 1 ||
      existingCounts.sessions < 1 ||
      existingCounts.events === 0
    ) {
      throw new Error(
        `Existing migration did not preserve data: ${JSON.stringify(existingCounts)}`
      );
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

smokeFresh();
smokeExisting();
console.log(
  "PASS: pm foundation migration preserves fresh and existing local D1 data."
);
