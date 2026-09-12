import { describe, expect, it } from "vitest";
import {
  evaluateUiSnapshot,
  runDemoReadinessGate,
} from "../server/demo/readiness.ts";
import {
  type DemoTranscript,
  demoScenarioCatalog,
  generateDemoTranscript,
  generateDemoTranscripts,
  scenarioById,
  transcriptToObservationSequence,
  validateDemoTranscript,
  workflowForScenario,
} from "../server/demo/simulator.ts";
import type { Snapshot } from "../shared/contracts.ts";

describe("demo transcript simulator", () => {
  it("generates deterministic Helios and Atlas text-only transcripts", () => {
    const first = generateDemoTranscripts({ seed: 28 });
    const second = generateDemoTranscripts({ seed: 28 });

    expect(first.transcripts).toEqual(second.transcripts);
    expect(first.validation.every((item) => item.valid)).toBe(true);
    expect(first.transcripts).toHaveLength(5);
    expect(demoScenarioCatalog().map((scenario) => scenario.id)).toEqual([
      "helios_p1",
      "atlas_feature",
    ]);
    expect(
      first.transcripts.flatMap((transcript) =>
        transcript.messages.map((message) => Object.keys(message).sort())
      )
    ).toContainEqual(["delay", "person_id", "text"]);
  });

  it("rejects cached transcripts that leak structured activity fields", () => {
    const transcript = generateDemoTranscript(
      "helios_p1",
      "v2_skip_review",
      28
    );
    const invalid = {
      ...transcript,
      messages: [
        {
          ...transcript.messages[0],
          activity_slug: "security_review",
        },
        ...transcript.messages.slice(1),
      ],
    } as DemoTranscript;

    expect(validateDemoTranscript(invalid).errors).toContain(
      "message_0_forbidden_field:activity_slug"
    );
  });

  it("renders Slack-like observations with stable sessions and permalinks", () => {
    const transcript = generateDemoTranscript(
      "helios_p1",
      "v2_skip_review",
      28
    );
    const sequence = transcriptToObservationSequence(transcript);

    expect(sequence.session.id).toBe("ses_helios_p1_v2_skip_review_28");
    expect(
      new Set(sequence.observations.map((item) => item.session_id))
    ).toEqual(new Set([sequence.session.id]));
    expect(sequence.messages[0]).toMatchObject({
      author_label: "Priya Raman",
      channel: scenarioById("helios_p1").channel,
      is_agent: false,
      workspace_id: "T_ARIADNEOS_DEMO",
    });
    expect(sequence.messages[0]?.permalink).toContain(
      "/archives/C_HELIOS_OPS/"
    );
    expect(workflowForScenario(scenarioById("helios_p1")).id).toBe(
      "wf_p1_incident"
    );
  });
});

describe("demo readiness gate", () => {
  it("validates observations through extraction, mining, conformance and UI snapshot", async () => {
    const report = await runDemoReadinessGate({
      now: new Date("2026-09-12T10:00:00.000Z"),
      seed: 28,
    });

    expect(report.passed).toBe(true);
    expect(report.metrics).toMatchObject({
      extracted_steps: 42,
      graph_nodes: 23,
      messages: 40,
      sessions: 5,
    });
    expect(report.metrics.expected_deviations).toEqual([
      "escalate_to_ceo",
      "improvise_hotfix",
      "hold_customer_call",
      "rework_edge",
      "negotiate_scope_offline",
    ]);
    expect(report.stages.map((stage) => [stage.name, stage.passed])).toEqual([
      ["transcripts", true],
      ["observations", true],
      ["extraction", true],
      ["mining", true],
      ["conformance", true],
      ["ui", true],
    ]);
    expect(
      report.snapshot?.graph.nodes.map((node) => node.activity.slug)
    ).toEqual(
      expect.arrayContaining(["improvise_hotfix", "hold_customer_call"])
    );
    expect(
      report.snapshot?.graph.edges.some((edge) => edge.kind === "rework")
    ).toBe(true);
    expect(
      report.snapshot?.conformance.flatMap((item) => item.violations)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ policy_id: "pol_sec_review" }),
      ])
    );
  });

  it("fails readiness before extraction when an expected deviation is missing", async () => {
    const transcript = generateDemoTranscript(
      "helios_p1",
      "v2_skip_review",
      28
    );
    const report = await runDemoReadinessGate({
      transcripts: [
        {
          ...transcript,
          expected_deviations: ["improvise_hotfix"],
        },
      ],
    });

    expect(report.passed).toBe(false);
    expect(report.stages).toEqual([
      expect.objectContaining({
        name: "transcripts",
        passed: false,
      }),
    ]);
  });

  it("fails UI readiness when step evidence cannot resolve to messages", async () => {
    const report = await runDemoReadinessGate({ seed: 28 });
    const { snapshot } = report;
    expect(snapshot).toBeDefined();
    if (!snapshot) {
      return;
    }
    const [firstStep] = snapshot.steps;
    const [firstEvidence] = firstStep?.evidence ?? [];
    expect(firstStep).toBeDefined();
    expect(firstEvidence).toBeDefined();
    if (!(firstStep && firstEvidence)) {
      return;
    }
    const broken = {
      ...snapshot,
      steps: [
        {
          ...firstStep,
          evidence: [
            {
              ...firstEvidence,
              message_id: "T_ARIADNEOS_DEMO:C_MISSING:999.000100",
            },
          ],
        },
        ...snapshot.steps.slice(1),
      ],
    } satisfies Snapshot;

    expect(evaluateUiSnapshot(broken).passed).toBe(false);
    expect(evaluateUiSnapshot(broken).evidence).toContain("missingEvidence=1");
  });
});
