// HTTP smoke checks against a running Worker.
//
// These assert the boundaries a deployment must hold regardless of whether any
// Slack workspace has connected a channel: authentication, tenancy, origin
// enforcement, body limits and error shapes. They create no process data, because
// process data may only come from observed Slack messages.

import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:8787";
let cookie = process.env.ARIADNE_TEST_COOKIE || "";

async function request(
  path,
  { body, method, origin = base, raw, session = true } = {}
) {
  const hasBody = body !== undefined || raw !== undefined;
  const response = await fetch(base + path, {
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    headers: {
      ...(hasBody
        ? { "Content-Type": "application/json", Origin: origin }
        : {}),
      ...(session && cookie ? { Cookie: cookie } : {}),
    },
    method: method ?? (hasBody ? "POST" : "GET"),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie && session) {
    [cookie] = setCookie.split(";");
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { data, status: response.status };
}

// --- Public surface -------------------------------------------------------
const health = await request("/api/health");
assert.equal(health.data.ok, true, "health must report ok");
assert.equal(
  health.data.source,
  "slack",
  "health must report Slack as the data source"
);
// --- Authentication -------------------------------------------------------
const authenticatedReads = [
  "/api/settings",
  "/api/snapshot",
  "/api/kb",
  "/api/sessions",
  "/api/messages",
  "/api/graph/overlay",
  "/api/setup/status",
];
for (const path of authenticatedReads) {
  const response = await request(path, { session: false });
  assert.equal(
    response.status,
    401,
    `${path} must refuse anonymous access, got ${response.status}`
  );
}
for (const path of ["/api/ask", "/api/setup/projects", "/api/graph/rebuild"]) {
  const response = await request(path, { body: {}, session: false });
  assert.equal(
    response.status,
    401,
    `${path} must refuse anonymous writes, got ${response.status}`
  );
}

// The Slack receiver authenticates with HMAC, not a session, and must fail
// closed on an unsigned request rather than accepting it.
const unsignedEvent = await request("/api/slack/events", {
  body: { type: "url_verification" },
  session: false,
});
assert.ok(
  unsignedEvent.status === 401 || unsignedEvent.status === 503,
  `unsigned Slack events must be refused, got ${unsignedEvent.status}`
);

if (!cookie) {
  console.log(
    "PASS: public and anonymous boundaries hold. Set ARIADNE_TEST_COOKIE for authenticated checks."
  );
  process.exit(0);
}

// --- Authenticated surface ------------------------------------------------
const settings = await request("/api/settings");
assert.equal(settings.status, 200, "settings must load for a valid session");
assert.ok(
  settings.data.slack.status === "installed" ||
    settings.data.slack.status === "not_installed",
  "settings must report the install status"
);
assert.ok(
  Array.isArray(settings.data.slack.channels),
  "settings must list observed channels"
);
assert.ok(
  typeof settings.data.extraction.configured === "boolean",
  "settings must report whether extraction is configured"
);
assert.ok(
  !JSON.stringify(settings.data).includes("xoxb-"),
  "settings must never leak a bot token"
);

const setup = await request("/api/setup/status");
assert.equal(setup.status, 200, "setup status must load");
assert.ok(
  typeof setup.data.ready === "boolean",
  "setup status must report readiness"
);
assert.ok(Array.isArray(setup.data.channels), "setup must list channels");
assert.ok(Array.isArray(setup.data.workflows), "setup must list workflows");

const snapshot = await request("/api/snapshot");
if (setup.data.ready || setup.data.channels.some((item) => item.enabled)) {
  assert.equal(
    snapshot.status,
    200,
    `snapshot must load once a channel is observed, got ${snapshot.status}`
  );
  assert.ok(snapshot.data.graph, "snapshot must include a graph");
  assert.ok(
    Array.isArray(snapshot.data.sessions),
    "snapshot must include sessions"
  );
  // A fresh deployment has authored activities but no observations. Any node
  // with support must trace back to a real message.
  for (const node of snapshot.data.graph.nodes ?? []) {
    if (node.activity.support > 0) {
      assert.ok(
        snapshot.data.messages.length > 0,
        "observed support requires message evidence"
      );
    }
  }
} else {
  assert.equal(
    snapshot.status,
    409,
    `snapshot must explain that no channel is observed, got ${snapshot.status}`
  );
  assert.equal(snapshot.data.error.code, "no_observed_channel");
}

// --- Tenancy --------------------------------------------------------------
const foreign = await request("/api/snapshot?project_id=proj_not_mine");
assert.ok(
  foreign.status === 400 || foreign.status === 409,
  `an unknown project must be refused, got ${foreign.status}`
);

// --- Input validation -----------------------------------------------------
assert.equal(
  (await request("/api/ask", { body: { question: "" } })).status,
  400,
  "an empty question must be refused"
);
assert.equal(
  (await request("/api/ask", { raw: "broken" })).status,
  400,
  "malformed JSON must be refused"
);
assert.equal(
  (await request("/api/setup/projects", { body: { name: "" } })).status,
  400,
  "a project without a name must be refused"
);
assert.equal(
  (
    await request("/api/setup/workflows", {
      body: { activities: [], name: "Empty", project_id: "proj_not_mine" },
    })
  ).status,
  400,
  "a workflow with no activities must be refused"
);
assert.equal(
  (await request("/api/steps/not%20a%20valid%20id/evidence")).status,
  400,
  "an unsafe step id must be refused"
);

// --- Origin enforcement ---------------------------------------------------
assert.equal(
  (
    await request("/api/ask", {
      body: { question: "hello" },
      origin: "https://evil.example",
    })
  ).status,
  403,
  "cross-origin writes must be refused"
);
assert.equal(
  (
    await request("/api/setup/policies/pol_x", {
      method: "DELETE",
      origin: "https://evil.example",
      raw: "",
    })
  ).status,
  403,
  "cross-origin deletes must be refused"
);

// --- Body limits ----------------------------------------------------------
assert.equal(
  (await request("/api/ask", { raw: "x".repeat(70_000) })).status,
  413,
  "an oversized body must be refused"
);

// --- Not found ------------------------------------------------------------
assert.equal(
  (await request("/api/does-not-exist")).status,
  404,
  "unknown API paths must 404"
);

console.log("PASS: authenticated smoke checks hold.");
