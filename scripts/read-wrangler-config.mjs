import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

const errors = [];
const config = parse(readFileSync("wrangler.jsonc", "utf8"), errors, {
  allowTrailingComma: true,
});
if (errors.length > 0) {
  throw new Error("Invalid Wrangler JSONC configuration");
}
process.stdout.write(JSON.stringify(config));
