> **Historical input spec — superseded.** The simulation, demo-workspace and
> checked-in knowledge base described here are not part of the application. See
> [../decisions/2026-09-14-no-simulated-data.md](../decisions/2026-09-14-no-simulated-data.md).

# Spec 02 — Knowledge Base & Ground Truth

**Implementation authority:** [Cloudflare contract](00-cloudflare-architecture.md) and
[scope](../SCOPE.md). Runtime, priorities and resolved edge cases there supersede older examples.


> The authored half of the world. Everything here is authored data bundled into the Worker and explicitly seeded into D1.
> It grounds the simulation, resolves entities during mining, and gives conformance something to
> compare against.

**Owner:** KB issue · **Location:** `kb/`, `server/kb.ts`, `scripts/seed-kb.ts`

---

## 1. Why the KB earns its place

| It feeds | How |
|---|---|
| **Simulation realism** | Personas speak from a profile with goals and biases, about a project with a real spec. No generic "as an AI" chatter. |
| **Mining precision** | Extracted steps resolve `actor` and `object` to **real entity ids**, not strings. This is the "clear reference" requirement — a step points at `per_priya` and `art_inc_4412`, which exist. |
| **Conformance** | The designed workflow + policies are the ground truth the discovered process is scored against. |
| **Graph-RAG** | `@Ariadne` answers traverse Org → Process → Execution → Message and cite permalinks. |

---

## 2. Files

```
kb/
├── people.yaml            6 people
├── projects.yaml          2 projects
├── artifacts.yaml         ~10 artifacts
├── policies.yaml          5 policies
└── workflows/
    ├── wf_p1_incident.yaml      designed process for Helios  (11 activities + 11×11 matrix)
    └── wf_feature_intake.yaml   designed process for Atlas   (8 activities + 8×8 matrix)
```

Loader: `server/kb.ts::loadKb()` consumes typed JSON fixtures bundled at build time and upserts
into D1 through `scripts/seed-kb.ts`. YAML below describes content; commit runtime data as JSON to
avoid filesystem reads or a runtime YAML parser. Seed explicitly after migrations, idempotently.
Do not reseed on every isolate startup or overwrite curated/observed data.

---

## 3. Schemas

### 3.1 `people.yaml`

```yaml
- id: per_priya
  name: Priya Raman
  role: support            # support | eng | pm | cpo | ceo | pmo
  seniority: lead
  emoji: ":woman_firefighter:"
  color: "#E8B84B"
  projects: [proj_helios]
  goals:
    - Protect SLA credits on enterprise accounts
    - Never let a customer find out from their own users
  biases:
    - Escalates fast, sometimes past the on-call rotation
  comms_style: "Short, factual, timestamps everything. Uses bullet fragments, no pleasantries."
```

Cast (fixed — do not add people, six is already a lot of voices in one channel):

| id | Name | Role | Agenda that creates conflict |
|---|---|---|---|
| `per_dana` | Dana Okafor | ceo | Retain the logo at any cost; pings engineers directly, skipping process |
| `per_sofia` | Sofia Lindqvist | cpo | Roadmap integrity; the person who says no |
| `per_marc` | Marc Delacroix | pm | Ship the date; will trade scope for time |
| `per_priya` | Priya Raman | support | Customer pain and SLA clock; escalates fast |
| `per_tom` | Tom Becker | eng (staff) | Correctness and tech debt; objects when review is skipped |
| `per_lea` | Léa Moreau | pmo | Process compliance and reporting; asks "was this logged?" |

### 3.2 `projects.yaml`

```yaml
- id: proj_helios
  name: Helios Payments
  summary: "Checkout and payment orchestration for enterprise merchants."
  workflow_id: wf_p1_incident
  spec_md: |
    Helios handles card + SEPA checkout for 40 enterprise merchants.
    Vertex Logistics is the largest (€2.1M ARR, renewal in November).
    SLA: P1 acknowledged in 15 min, mitigated in 4 h. Credits accrue after 4 h.
  constraints:
    - "Any production deploy requires a passing security review (policy pol_sec_review)."
    - "Customer credits above €10,000 need CPO or CEO approval."

- id: proj_atlas
  name: Atlas Self-Serve Billing
  summary: "Self-serve billing and plan management for the SMB tier."
  workflow_id: wf_feature_intake
  spec_md: |
    Atlas is the Q4 bet to move SMBs off sales-assisted billing.
    Roadmap is frozen after the Q4 planning lock (Sept 1).
    Enterprise asks that arrive after the lock must pass roadmap review.
  constraints:
    - "Roadmap changes require CPO review before the roadmap is updated."
    - "Any request estimated above 20 engineer-days needs CEO approval."
```

### 3.3 `artifacts.yaml`

```yaml
- {id: art_inc_4412, type: incident, name: "INC-4412 Vertex checkout 500s", project_id: proj_helios, uri: "https://status.internal/INC-4412"}
- {id: art_runbook_pay, type: doc, name: "Payments runbook", project_id: proj_helios, uri: "..."}
- {id: art_sec_checklist, type: doc, name: "Pre-deploy security checklist", project_id: proj_helios}
- {id: art_roadmap_q4, type: doc, name: "Q4 roadmap (locked)", project_id: proj_atlas}
- {id: art_req_vertex_sso, type: ticket, name: "REQ-88 Vertex SSO for billing portal", project_id: proj_atlas}
# ...~10 total
```

### 3.4 `policies.yaml`

```yaml
- id: pol_sec_review
  project_id: proj_helios
  kind: ordering                 # mandatory | ordering | approval | threshold
  activity_slug: security_review
  text: "A security review must complete before any production deploy."
  params: {before: security_review, after: deploy_fix}

- id: pol_credit_approval
  project_id: proj_helios
  kind: threshold
  activity_slug: issue_service_credit
  text: "Service credits above €10,000 require CPO or CEO approval."
  params: {limit: 10000, roles: [cpo, ceo]}

- id: pol_postmortem
  project_id: proj_helios
  kind: mandatory
  activity_slug: write_postmortem
  text: "Every P1 requires a written postmortem."

- id: pol_roadmap_review
  project_id: proj_atlas
  kind: ordering
  activity_slug: roadmap_review
  text: "The roadmap may not be changed before CPO roadmap review."
  params: {before: roadmap_review, after: update_roadmap}

- id: pol_exec_threshold
  project_id: proj_atlas
  kind: approval
  activity_slug: exec_approval
  text: "Requests above 20 engineer-days require CEO approval."
  params: {roles: [ceo], after: estimate_effort}
```

---

## 4. The designed process — N×N matrix

This is the ground truth the discovered graph is scored against. Row = from, column = to,
value = expected transition (`0` = not expected, `1` = expected, `0 < p < 1` = permitted but optional).

`kb/workflows/wf_p1_incident.yaml`:

```yaml
id: wf_p1_incident
name: Enterprise P1 incident response
project_id: proj_helios
entry_activity: detect_incident
exit_activities: [notify_customer, write_postmortem]

activities:                       # index order defines the matrix axes
  - {slug: detect_incident,      label: "Detect incident",        role: support}
  - {slug: triage_incident,      label: "Triage severity",        role: support}
  - {slug: open_incident_ticket, label: "Open incident ticket",   role: support}
  - {slug: assign_owner,         label: "Assign incident owner",  role: pm}
  - {slug: reproduce_issue,      label: "Reproduce the issue",    role: eng}
  - {slug: root_cause_analysis,  label: "Root cause analysis",    role: eng}
  # `synonyms` feed the graph-RAG lexicon (spec 07 §4) — how people really say it in the channel
  - {slug: security_review,      label: "Security review",        role: eng,
     synonyms: ["security review", "pre-deploy checklist", "the checklist", "sec review"]}
  - {slug: deploy_fix,           label: "Deploy the fix",         role: eng}
  - {slug: verify_resolution,    label: "Verify resolution",      role: support}
  - {slug: notify_customer,      label: "Notify the customer",    role: pm}
  - {slug: write_postmortem,     label: "Write the postmortem",   role: pmo}

# 11×11.  Columns in the same order as `activities`.
#        det tri opn asn rep rca sec dep ver not pos
matrix:
  - [  0,  1,  0,  0,  0,  0,  0,  0,  0,  0,  0 ]   # detect_incident
  - [  0,  0,  1,  0,  0,  0,  0,  0,  0,  0,  0 ]   # triage_incident
  - [  0,  0,  0,  1,  0,  0,  0,  0,  0,  0,  0 ]   # open_incident_ticket
  - [  0,  0,  0,  0,  1,  0,  0,  0,  0,  0,  0 ]   # assign_owner
  - [  0,  0,  0,  0,  0,  1,  0,  0,  0,  0,  0 ]   # reproduce_issue
  - [  0,  0,  0,  0,  0,  0,  1,  0,  0,  0,  0 ]   # root_cause_analysis
  - [  0,  0,  0,  0,  0,  0,  0,  1,  0,  0,  0 ]   # security_review
  - [  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  0 ]   # deploy_fix
  - [  0,  0,  0,  0, 0.3, 0,  0,  0,  0,  1,  0 ]   # verify_resolution (0.3 = re-open loop tolerated)
  - [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1 ]   # notify_customer
  - [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0 ]   # write_postmortem
policy_ids: [pol_sec_review, pol_credit_approval, pol_postmortem]
```

`kb/workflows/wf_feature_intake.yaml` — same shape, 8 activities:
`capture_request → qualify_business_case → estimate_effort → roadmap_review → exec_approval →
update_roadmap → communicate_decision → create_epic`, policies `pol_roadmap_review`,
`pol_exec_threshold`.

### 4.1 Activities the documentation does NOT contain

These are deliberately absent from every matrix. The simulation makes them happen anyway, so mining
discovers them as **gold / undocumented** nodes. This is the punchline of the demo:

| Discovered-only activity | Why it happens in reality |
|---|---|
| `escalate_to_ceo` | Priya pings Dana directly when the SLA clock is burning |
| `improvise_hotfix` | Tom ships a mitigation before root cause is known |
| `hold_customer_call` | Marc calls Vertex before the fix is verified |
| `negotiate_scope_offline` | Sofia and Marc settle roadmap conflict in DM-style side chat |

---

## 5. Loading & the Org graph

```text
load_kb() -> None
  # people, projects, artifacts, policies → tables
  # workflows → activity rows with plane="designed", role_expected
  #           → follows rows with plane="designed", weight=matrix[i][j]
  #           → workflow row with matrix stored as JSON
```

After load, the designed plane is fully present in `activity` and `follows` **before a single Slack
message arrives.** The UI can therefore render the grey documented process at t=0, and the demo is
the discovered layer lighting up on top of it.

---

## 6. Graph-RAG (P1)

`server/rag.ts::answer(question, scope)` returns `{answer, citations, subgraph}`.

Full design in **spec 07**. What the KB owes it:

1. **Every entity contributes surface forms to the lexicon** — `Person.name` plus first name,
   `Project.name`, `Artifact.name` plus its id pattern (`INC-4412`, `inc 4412`, `4412`),
   `Activity.slug` and `label`, `Policy.id`, `Workflow.name`.
2. **Activities carry authored `synonyms`** — how people *actually* refer to the activity in the
   channel. No string-distance metric gets you from *"the checklist"* to `security_review`; a human
   writes that down once, in the workflow YAML (§4).


Answers are posted back into Slack in the `@Ariadne` path (spec 04 §7) and rendered in the UI
inspector. No embeddings, no vector store — the graph is the index.

---

## 7. Definition of done

- [ ] `loadKb()` populates 6 people, 2 projects, ~10 artifacts, 5 policies, 2 designed workflows
- [ ] `GET /api/graph/designed?workflow_id=` returns a renderable grey DAG before any simulation runs
- [ ] A mined step can resolve `actor_person_id` and `artifact_id` to real KB ids ≥80% of the time
- [ ] P1: `answer("what happens after a P1 is triaged?")` returns prose with ≥2 Slack permalinks
