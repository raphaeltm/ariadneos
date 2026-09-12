import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKbSeedStatements, kbSummary, loadKb } from "../server/kb.ts";

interface Options {
  database: string;
  dryRun: boolean;
  env?: string;
  remote: boolean;
}

const scriptOptions = parseArgs(process.argv.slice(2));
const kb = loadKb();
const seedSql = buildKbSeedStatements(kb)
  .map((statement) => interpolateStatement(statement.sql, statement.bindings))
  .join("\n");

if (scriptOptions.dryRun) {
  console.log(seedSql);
  console.error(JSON.stringify(kbSummary(kb), null, 2));
  process.exit(0);
}

const directory = mkdtempSync(join(tmpdir(), "ariadneos-kb-"));
const file = join(directory, "seed-kb.sql");
writeFileSync(file, `${seedSql}\n`);

try {
  const args = [
    "wrangler",
    "d1",
    "execute",
    scriptOptions.database,
    "--file",
    file,
  ];
  if (scriptOptions.env) {
    args.push("--env", scriptOptions.env);
  }
  args.push(scriptOptions.remote ? "--remote" : "--local");
  const result = spawnSync("npx", args, {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.error(JSON.stringify(kbSummary(kb), null, 2));
} finally {
  rmSync(directory, { force: true, recursive: true });
}

function interpolateStatement(
  statementSql: string,
  bindings: (null | number | string)[]
) {
  let index = 0;
  return `${statementSql.replaceAll("?", () => {
    const binding = bindings[index];
    index += 1;
    if (binding === undefined) {
      throw new Error("SQL statement has more placeholders than bindings");
    }
    return quoteSql(binding);
  })};`;
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    database: "ariadneos-demo",
    dryRun: false,
    remote: false,
  };
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--database") {
      index += 1;
      parsed.database = requireValue(args, index, arg);
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--env") {
      index += 1;
      parsed.env = requireValue(args, index, arg);
    } else if (arg === "--remote") {
      parsed.remote = true;
    } else if (arg === "--local") {
      parsed.remote = false;
    } else {
      throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
    index += 1;
  }
  return parsed;
}

function quoteSql(value: null | number | string) {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
