import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

// Read-only checks: production verification never creates simulation data.
// The staging agent smoke path may call the configured model until its shared budget is exhausted.
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
const BUDGET = /budget/i;
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
  const agentStatusResponse = await fetch(`${base}/api/agent/status`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(agentStatusResponse.status, 200, "Agent status must respond");
  const agentStatus = await agentStatusResponse.json();
  assert.equal(agentStatus.executor, "mastra-embedded");
  assert.equal(agentStatus.fallback, "typed-fetch");
  assert.equal(typeof agentStatus.config.models.answer, "string");
  assert.equal(
    JSON.stringify(agentStatus).includes("OPENROUTER_API_KEY"),
    false
  );
  if (environment === "staging") {
    assert.equal(
      agentStatus.config.enabled,
      true,
      "Staging must enable the OpenRouter smoke path"
    );
    assert.equal(
      agentStatus.config.hasOpenRouterKey,
      true,
      "Staging is missing the OPENROUTER_API_KEY secret"
    );
    const smokeResponse = await fetch(`${base}/api/agent/smoke`, {
      body: "{}",
      headers: { "Content-Type": "application/json", Origin: base },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    const smoke = await smokeResponse.json();
    if (smokeResponse.status === 429) {
      assert.equal(
        smoke.status,
        "budget_exhausted",
        "Agent smoke 429 must be the shared budget guard"
      );
      assert.match(smoke.error ?? "", BUDGET);
    } else {
      assert.equal(smokeResponse.status, 200, "Agent smoke must succeed");
      assert.equal(smoke.ok, true);
      assert.equal(smoke.status, "ok");
      assert.ok(
        ["mastra-embedded", "typed-fetch"].includes(smoke.executor),
        "Smoke response must report the executor that passed"
      );
      assert.equal(smoke.model, agentStatus.config.models.answer);
    }
  }
  console.log(
    `PASS: ${base} serves ${environment} ${health.revision}; TLS, D1, app bundle, auth availability, Slack webhook signing, anonymous data protection, and agent runtime status verified.`
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
