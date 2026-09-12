import assert from "node:assert/strict";
// Read-only checks: production verification never creates simulation data or calls AI.
const [base, environment, revision] = process.argv.slice(2);
assert.ok(
  base && ["staging", "production"].includes(environment),
  "Usage: node scripts/check-deployment.mjs URL staging|production [COMMIT_SHA]",
);
assert.equal(
  new URL(base).protocol,
  "https:",
  "Deployment checks require verified HTTPS",
);
async function check() {
  const response = await fetch(`${base}/api/health`, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  assert.equal(response.status, 200, "Health endpoint must succeed");
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(
    health.environment,
    environment,
    "Wrong environment is serving this hostname",
  );
  if (revision)
    assert.equal(health.revision, revision, "Expected commit is not live yet");
  const htmlResponse = await fetch(base, {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(htmlResponse.status, 200, "App must load");
  const html = await htmlResponse.text();
  assert.match(html, /AriadneOS/);
  for (const path of ["/app", "/app/"]) {
    const appResponse = await fetch(new URL(path, base), {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(
      appResponse.status,
      200,
      `${path} must support direct navigation`,
    );
    assert.match(appResponse.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await appResponse.text(), /id="root"/);
  }
  const script = html.match(/src="([^\"]+\.js)"/);
  assert.ok(script, "App HTML must reference a JavaScript bundle");
  const asset = await fetch(new URL(script[1], base), {
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(asset.status, 200, "Frontend bundle must load");
  assert.match(asset.headers.get("content-type") ?? "", /javascript/);
  for (const workflow of ["vendor", "refund", "access"]) {
    const response = await fetch(`${base}/api/model?workflow=${workflow}`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.workflow.id, workflow);
    assert.equal(snapshot.model.stats.cases, 24, "Baseline seed must exist");
    assert.ok(
      snapshot.model.edges.length > 0,
      "Process graph must have evidence",
    );
  }
  console.log(
    `PASS: ${base} serves ${environment} ${health.revision}; TLS, D1, app bundle, and all workflow baselines verified.`,
  );
}
// Allow time for a new custom domain or Worker revision to become available.
let lastError;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    await check();
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`Readiness attempt ${attempt + 1}/12: ${error.message}`);
    if (attempt < 11)
      await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
throw lastError;
