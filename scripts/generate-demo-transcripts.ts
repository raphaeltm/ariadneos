import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateDemoTranscripts } from "../server/demo/simulator.ts";

const outDir = "fixtures/transcripts";
const seedArg = process.argv.find((arg) => arg.startsWith("--seed="));
const seed = seedArg ? Number(seedArg.slice("--seed=".length)) : 28;

if (!Number.isInteger(seed)) {
  throw new Error("--seed must be an integer.");
}

const generated = generateDemoTranscripts({ seed });
const invalid = generated.validation.filter((item) => !item.valid);
if (invalid.length) {
  throw new Error(
    `Cannot write invalid transcripts: ${invalid
      .map((item) => `${item.scenario_id}/${item.variant}`)
      .join(", ")}`
  );
}

await mkdir(outDir, { recursive: true });
await Promise.all(
  generated.transcripts.map((transcript) =>
    writeFile(
      join(outDir, `${transcript.scenario_id}.${transcript.variant}.json`),
      `${JSON.stringify(transcript, null, 2)}\n`
    )
  )
);

console.log(
  `PASS: wrote ${generated.transcripts.length} demo transcripts to ${outDir}.`
);
