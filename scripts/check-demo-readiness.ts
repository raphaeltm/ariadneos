import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runDemoReadinessGate } from "../server/demo/readiness.ts";
import type { DemoTranscript } from "../server/demo/simulator.ts";

const fixtureArg = process.argv.find((arg) => arg.startsWith("--fixtures="));
const fixtureDir = fixtureArg?.slice("--fixtures=".length);
const transcripts = fixtureDir ? await readTranscripts(fixtureDir) : undefined;

const report = await runDemoReadinessGate({ transcripts });
for (const stage of report.stages) {
  const mark = stage.passed ? "PASS" : "FAIL";
  console.log(`${mark}: ${stage.name} - ${stage.detail}`);
  for (const item of stage.evidence) {
    console.log(`  ${item}`);
  }
}

if (!report.passed) {
  process.exitCode = 1;
  throw new Error("Demo readiness gate failed.");
}
console.log(
  `PASS: demo readiness gate validated ${report.metrics.sessions} sessions, ${report.metrics.messages} messages, ${report.metrics.extracted_steps} extracted steps, ${report.metrics.graph_nodes} graph nodes.`
);

async function readTranscripts(dir: string): Promise<DemoTranscript[]> {
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".json"))
    .map((file) => join(dir, file))
    .sort();
  if (!files.length) {
    throw new Error(`No transcript fixtures found in ${dir}.`);
  }
  return await Promise.all(
    files.map(
      async (file) => JSON.parse(await readFile(file, "utf8")) as DemoTranscript
    )
  );
}
