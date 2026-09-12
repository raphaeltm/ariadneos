import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

// Read-only checks: production verification never creates simulation data or calls AI.
const [base, environment, revision] = process.argv.slice(2);
assert.ok(
  base && ["staging", "production"].includes(environment),
  "Usage: node scripts/check-deployment.mjs URL staging|production [COMMIT_SHA]"
);
assert.equal(
  new URL(base).protocol,
  "https:",
  "Deployment checks require verified HTTPS"
);
const APP_NAME = /AriadneOS/;
const SCRIPT = /src="([^"]+\.js)"/;
const JAVASCRIPT = /javascript/;
async function check() {
  const response = await fetch(`${base}/api/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, "Health endpoint must succeed");
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(
    health.environment,
    environment,
    "Wrong environment is serving this hostname"
  );
  if (revision) {
    assert.equal(health.revision, revision, "Expected commit is not live yet");
  }
  const htmlResponse = await fetch(base, {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(htmlResponse.status, 200, "App must load");
  const html = await htmlResponse.text();
  assert.match(html, APP_NAME);
  const script = html.match(SCRIPT);
  assert.ok(script, "App HTML must reference a JavaScript bundle");
  const asset = await fetch(new URL(script[1], base), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(asset.status, 200, "Frontend bundle must load");
  assert.match(asset.headers.get("content-type") ?? "", JAVASCRIPT);
  const sessionResponse = await fetch(`${base}/api/auth/get-session`, {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    sessionResponse.status,
    200,
    "Authentication must be configured before staging is ready"
  );
  assert.equal(
    await sessionResponse.json(),
    null,
    "Anonymous requests must not have a session"
  );
  for (const path of [
    "/api/model?workflow=vendor",
    "/api/model?workflow=refund",
    "/api/model?workflow=access",
    "/api/context",
  ]) {
    const protectedResponse = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(
      protectedResponse.status,
      401,
      "Process data must require login"
    );
  }
  assert.ok(
    process.env.SLACK_SIGNING_SECRET,
    "Webhook signing secret must be supplied to readiness check"
  );
  const challenge = randomUUID();
  const body = JSON.stringify({ challenge, type: "url_verification" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  const webhook = await fetch(`${base}/api/slack/events`, {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": `v0=${signature}`,
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(webhook.status, 200, "Signed webhook challenge must succeed");
  assert.deepEqual(await webhook.json(), { challenge });
  const unsigned = await fetch(`${base}/api/slack/events`, {
    body,
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(unsigned.status, 401, "Unsigned webhooks must be rejected");
  console.log(
    `PASS: ${base} serves ${environment} ${health.revision}; TLS, D1, app bundle, auth availability, and anonymous data protection verified.`
  );
}
// Allow time for a new custom domain or Worker revision to become available.
let lastError;
for (let attempt = 0; attempt < 12; attempt += 1) {
  try {
    await check();
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`Readiness attempt ${attempt + 1}/12: ${error.message}`);
    if (attempt < 11) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
throw lastError;
