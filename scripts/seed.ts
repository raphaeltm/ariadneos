import { simulate } from "../shared/simulation";
import { writeFileSync } from "node:fs";
const events = (["vendor", "refund", "access"] as const).flatMap((w, i) =>
  simulate(w, 42 + i * 7, 24),
);
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
writeFileSync(
  "migrations/0002_seed.sql",
  "-- Reproducible synthetic observations. No real organization data.\n" +
    events
      .map(
        (e) =>
          `INSERT OR IGNORE INTO events(id,session_id,workflow,case_id,occurred_at,payload) VALUES (${[e.id, "baseline", e.workflow, e.caseId, e.timestamp, JSON.stringify(e)].map(quote).join(",")});`,
      )
      .join("\n") +
    "\n",
);
