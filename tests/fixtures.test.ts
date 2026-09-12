import { describe, expect, it } from "vitest";
import type {
  Activity,
  EvidenceRef,
  JournalEnvelope,
  Message,
  Step,
} from "../shared/contracts.ts";
import type { ContractFixtureSet } from "../shared/fixture-validation.ts";
import {
  assertValidFixtureSet,
  contractFixtureSet,
  validateFixtureSet,
} from "../shared/fixture-validation.ts";

const copyFixtureSet = () =>
  structuredClone(contractFixtureSet) as ContractFixtureSet;

const errorsFor = (fixtureSet: ContractFixtureSet) =>
  validateFixtureSet(fixtureSet).errors.join("\n");

describe("contract fixture validation", () => {
  it("accepts the bundled synthetic fixture set", () => {
    expect(validateFixtureSet().errors).toEqual([]);
  });

  it("catches invalid evidence references", () => {
    const fixtureSet = copyFixtureSet();
    const [firstStep] = fixtureSet.snapshot.steps;
    if (!firstStep) {
      throw new Error("Missing fixture step");
    }
    const [firstEvidence] = firstStep.evidence;
    if (!firstEvidence) {
      throw new Error("Missing fixture evidence");
    }
    firstStep.evidence[0] = {
      ...firstEvidence,
      message_id: "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:999999.000000",
      ts: "999999.000000",
    };
    expect(errorsFor(fixtureSet)).toContain("references missing evidence");
  });

  it("catches unknown ids", () => {
    const fixtureSet = copyFixtureSet();
    const [firstStep] = fixtureSet.snapshot.steps;
    if (!firstStep) {
      throw new Error("Missing fixture step");
    }
    firstStep.actor_person_id = "per_unknown" as Step["actor_person_id"];
    expect(errorsFor(fixtureSet)).toContain(
      "references unknown actor per_unknown"
    );
  });

  it("catches inconsistent graph revisions", () => {
    const fixtureSet = copyFixtureSet();
    const [firstDelta] = fixtureSet.deltas;
    if (!firstDelta) {
      throw new Error("Missing fixture delta");
    }
    firstDelta.base_revision = fixtureSet.snapshot.graph.revision - 1;
    expect(errorsFor(fixtureSet)).toContain("base revision 6 does not match 7");
  });

  it("catches wrong graph delta shapes", () => {
    const fixtureSet = copyFixtureSet();
    fixtureSet.journal = [
      {
        channel: "C_SYNTH_PROCESS",
        id: 200,
        kind: "graph_delta",
        payload: { view_key: "overlay:wf_p1_incident:min1" },
        project_id: "proj_helios",
        session_id: "ses_helios_skip_review",
        ts: "2026-09-12T10:04:00.000Z",
        workspace_id: "T_SYNTH_FIXTURE",
      } satisfies JournalEnvelope,
    ];
    expect(errorsFor(fixtureSet)).toContain(
      "graph_delta has wrong payload shape"
    );
  });

  it("catches removal deltas that leave edges attached to removed nodes", () => {
    const fixtureSet = copyFixtureSet();
    const [firstDelta] = fixtureSet.deltas;
    const [firstEdge] = fixtureSet.snapshot.graph.edges;
    if (!(firstDelta && firstEdge)) {
      throw new Error("Missing fixture delta or edge");
    }
    firstDelta.nodes_removed = [firstEdge.from];
    firstDelta.edges_updated = [firstEdge];
    expect(errorsFor(fixtureSet)).toContain("attached to a removed node");
  });

  it("catches support counts from work that is not done and confirmed", () => {
    const fixtureSet = copyFixtureSet();
    const [activity] = fixtureSet.snapshot.kb.activities;
    if (!activity) {
      throw new Error("Missing fixture activity");
    }
    activity.support += 1;
    activity.occurrences += 1;
    const errors = errorsFor(fixtureSet);
    expect(errors).toContain("does not match done confirmed sessions");
    expect(errors).toContain("does not match done confirmed steps");
  });

  it("catches unknown promise-report reconciliation step ids", () => {
    const fixtureSet = copyFixtureSet();
    const [reconciliation] = fixtureSet.reconciliations;
    if (!reconciliation) {
      throw new Error("Missing fixture reconciliation");
    }
    reconciliation.source_step_id = "stp_unknown";
    reconciliation.report_step_id = "stp_unknown_report";
    const errors = errorsFor(fixtureSet);
    expect(errors).toContain(
      "reconciliation references unknown source step stp_unknown"
    );
    expect(errors).toContain(
      "reconciliation references unknown report step stp_unknown_report"
    );
  });

  it("reports malformed KB, graph, journal and error fixture records", () => {
    const fixtureSet = copyFixtureSet();
    const [workflow] = fixtureSet.snapshot.kb.workflows;
    const [activity] = fixtureSet.snapshot.kb.activities;
    const [artifact] = fixtureSet.snapshot.kb.artifacts;
    const [session] = fixtureSet.snapshot.sessions;
    const [messageRecord, secondMessage] = fixtureSet.snapshot.messages;
    const [stepRecord, secondStep] = fixtureSet.snapshot.steps;
    const [graphNode] = fixtureSet.snapshot.graph.nodes;
    const [graphEdge] = fixtureSet.snapshot.graph.edges;
    const [conformance] = fixtureSet.snapshot.conformance;
    const [delta] = fixtureSet.deltas;
    if (
      !(
        workflow &&
        activity &&
        artifact &&
        session &&
        messageRecord &&
        secondMessage &&
        stepRecord &&
        secondStep &&
        graphNode &&
        graphEdge &&
        conformance &&
        delta
      )
    ) {
      throw new Error("Missing fixture records");
    }

    workflow.project_id = "proj_unknown";
    workflow.matrix = [[0]];
    activity.policy_ids = ["pol_unknown"];
    artifact.project_id = "proj_unknown";
    session.project_id = "proj_unknown";
    session.workflow_id = "wf_unknown";
    messageRecord.session_id = "ses_unknown";
    messageRecord.id = "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:bad" as Message["id"];
    stepRecord.session_id = "ses_unknown";
    stepRecord.activity_id = "act_unknown";
    stepRecord.handoff_to_person_id = "per_unknown";
    stepRecord.artifact_id = "art_unknown";
    stepRecord.evidence = [];
    stepRecord.modality = "negated";
    stepRecord.negated = false;
    fixtureSet.snapshot.steps[1] = {
      ...secondStep,
      evidence: [
        {
          channel: "C_OTHER",
          message_id: "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:091700.000200",
          message_revision: 99,
          ts: "091700.000200",
          workspace_id: "T_OTHER",
        },
      ],
    } as Step;
    const unavailableEvidence: EvidenceRef = {
      channel: "C_SYNTH_PROCESS",
      message_id: "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:091700.000200",
      message_revision: 1,
      ts: "091700.000200",
      workspace_id: "T_SYNTH_FIXTURE",
    };
    fixtureSet.snapshot.messages[1] = {
      ...secondMessage,
      availability: "deleted",
      deleted: true,
    } as Message;
    conformance.session_id = "ses_unknown";
    conformance.violations[0] = {
      evidence: [unavailableEvidence],
      policy_id: "pol_unknown",
      quote: "Synthetic bad violation",
      text: "Synthetic bad policy",
    };
    fixtureSet.snapshot.graph.revision = -1;
    fixtureSet.snapshot.graph.project_id = "proj_unknown";
    fixtureSet.snapshot.graph.workflow_id = "wf_unknown";
    graphNode.activity = {
      ...graphNode.activity,
      id: "act_graph_unknown",
    };
    graphNode.id = "act_other" as Activity["id"];
    graphEdge.to = "act_not_in_graph";
    graphEdge.observed_support = graphEdge.cases.length + 1;
    delta.view_key = "overlay:other";
    delta.revision = delta.base_revision + 2;
    delta.nodes_removed = ["act_missing"];
    delta.edges_removed = ["ged_missing"];
    delta.edges_updated = [{ ...graphEdge, id: "ged_missing" }];
    fixtureSet.journal = [
      {
        channel: "C_SYNTH_PROCESS",
        id: 4,
        kind: "message",
        payload: messageRecord,
        project_id: "proj_helios",
        ts: "2026-09-12T10:04:00.000Z",
        workspace_id: "T_SYNTH_FIXTURE",
      },
      {
        channel: "C_SYNTH_PROCESS",
        id: 3,
        kind: "message",
        payload: messageRecord,
        project_id: "proj_helios",
        ts: "2026-09-12T10:05:00.000Z",
        workspace_id: "T_SYNTH_FIXTURE",
      },
    ];
    fixtureSet.errors = [null, { error: { code: 42, message: null } }];

    const errors = errorsFor(fixtureSet);
    expect(errors).toContain(
      "workflow wf_p1_incident references unknown project proj_unknown"
    );
    expect(errors).toContain("matrix row count does not match activity_slugs");
    expect(errors).toContain("matrix row 0 has the wrong width");
    expect(errors).toContain(
      "activity act_detect_incident references unknown policy pol_unknown"
    );
    expect(errors).toContain(
      "artifact art_inc_4412 references unknown project proj_unknown"
    );
    expect(errors).toContain(
      "session ses_helios_textbook references unknown project proj_unknown"
    );
    expect(errors).toContain("references unknown workflow wf_unknown");
    expect(errors).toContain(
      "message T_SYNTH_FIXTURE:C_SYNTH_PROCESS:bad references unknown session"
    );
    expect(errors).toContain("does not match workspace/channel/ts");
    expect(errors).toContain(
      "step stp_helios_textbook_detect references unknown session"
    );
    expect(errors).toContain("references unknown activity act_unknown");
    expect(errors).toContain("references unknown handoff target per_unknown");
    expect(errors).toContain("references unknown artifact art_unknown");
    expect(errors).toContain("has no evidence");
    expect(errors).toContain("has inconsistent negated modality/state");
    expect(errors).toContain("has inconsistent scope");
    expect(errors).toContain("has stale revision");
    expect(errors).toContain("is unavailable");
    expect(errors).toContain(
      "conformance references unknown session ses_unknown"
    );
    expect(errors).toContain("violation references unknown policy pol_unknown");
    expect(errors).toContain(
      "graph overlay:wf_p1_incident:min1 has invalid revision -1"
    );
    expect(errors).toContain("contains unknown activity act_graph_unknown");
    expect(errors).toContain("does not match activity act_graph_unknown");
    expect(errors).toContain("references nodes outside graph");
    expect(errors).toContain("support does not match cases");
    expect(errors).toContain("delta overlay:other does not apply to graph");
    expect(errors).toContain("revision must advance by one");
    expect(errors).toContain("removes unknown node act_missing");
    expect(errors).toContain("removes unknown edge ged_missing");
    expect(errors).toContain("both removes and upserts edge ged_missing");
    expect(errors).toContain("journal event 3 is not monotonic");
    expect(errors).toContain("error fixture 0 is not an object");
    expect(errors).toContain("error fixture 1 does not match ApiError");
  });

  it("throws an aggregate fixture validation error for scripts", () => {
    const fixtureSet = copyFixtureSet();
    const [firstStep] = fixtureSet.snapshot.steps;
    if (!firstStep) {
      throw new Error("Missing fixture step");
    }
    firstStep.evidence = [];
    expect(() => assertValidFixtureSet(fixtureSet)).toThrow(
      "Contract fixtures are invalid"
    );
  });
});
