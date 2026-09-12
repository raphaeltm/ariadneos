import assert from "node:assert/strict";

const base = process.argv[2] || "http://127.0.0.1:8787";
let cookie = "";
async function request(
  path,
  { body, session = true, origin = base, raw } = {}
) {
  const response = await fetch(base + path, {
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    headers: {
      ...(body !== undefined || raw !== undefined
        ? { "Content-Type": "application/json", Origin: origin }
        : {}),
      ...(session && cookie ? { Cookie: cookie } : {}),
    },
    method: body !== undefined || raw !== undefined ? "POST" : "GET",
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie && session) {
    [cookie] = setCookie.split(";");
  }
  return { data: await response.json(), status: response.status };
}
assert.equal((await request("/api/health")).data.ok, true);
for (const workflow of ["vendor", "refund", "access"]) {
  const { status, data } = await request(`/api/model?workflow=${workflow}`);
  assert.equal(status, 200);
  assert.equal(data.model.stats.cases, 24);
  assert.ok(data.model.edges.length > 0);
  assert.equal(data.source, "simulation");
}
assert.equal(
  (await request("/api/simulate", { body: { workflow: "vendor" } })).status,
  200
);
const model = (await request("/api/model?workflow=vendor")).data;
assert.equal(model.model.stats.cases, 30);
assert.equal(model.remainingRuns, 4);
assert.equal(
  (await request("/api/model?workflow=vendor", { session: false })).data.model
    .stats.cases,
  24
);
assert.equal(
  (await request("/api/model?workflow=vendor")).data.model.stats.cases,
  30
);
const context = (await request("/api/context?workflow=vendor")).data;
assert.equal(context.stats.cases, 30);
const ids = new Set(model.events.map((e) => e.id));
for (const edge of context.edges) {
  for (const item of edge.evidence) {
    assert.ok(ids.has(item.from));
    assert.ok(ids.has(item.to));
  }
}
assert.equal((await request("/api/model?workflow=unknown")).status, 400);
assert.equal((await request("/api/simulate", { body: null })).status, 400);
assert.equal((await request("/api/ask", { body: null })).status, 400);
assert.equal(
  (await request("/api/ask", { body: { question: "", workflow: "vendor" } }))
    .status,
  400
);
assert.equal((await request("/api/simulate", { raw: "broken" })).status, 400);
assert.equal(
  (
    await request("/api/simulate", {
      body: { workflow: "vendor" },
      origin: "https://example.org",
    })
  ).status,
  403
);
assert.equal(
  (await request("/api/ask", { raw: "x".repeat(5000) })).status,
  413
);
for (let i = 0; i < 4; i += 1) {
  assert.equal(
    (await request("/api/simulate", { body: { workflow: "refund" } })).status,
    200
  );
}
assert.equal(
  (await request("/api/simulate", { body: { workflow: "refund" } })).status,
  429
);
assert.equal(
  (await request("/api/model?workflow=refund")).data.remainingRuns,
  0
);
console.log(
  "PASS: health, all workflows, D1 persistence, session isolation, evidence integrity, input validation, origin checks, body limits, and five-run cap."
);
