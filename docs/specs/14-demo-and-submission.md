# Spec 14 — Demo & Submission

> The last spec. Everything here is executable by a presenter reading it once.
> Deadline **16:30 CEST**. Record **15:40–16:00**. Submit **by 16:15**.

---

## 1. Two demos — pick at 15:30 by what actually runs

| | **A — the claim** | **B — the fallback** |
|---|---|---|
| Condition | `/api/extract` works end to end | extractor not landed |
| The story | conversation in, structure out, graph from structure | process mining over an event log, plus documented-vs-actual |
| Headline line | *"nobody labelled any of this"* | *"the process nobody wrote down, measured"* |
| Honest caveat | the conversation is cached; extraction is live | events are synthetic; the mining is real |

**Decide by running it once at 15:30, not by hoping.** Both are respectable demos. A is a different
category of claim, which is why the whole change list points at it.

Everything below is written for A, with B's substitution marked ⧫.

---

## 2. The two-minute video

| Time | On screen | Say this |
|---|---|---|
| **0:00–0:12** | The app, graph already showing a grey documented process. Nothing running. | "Every company has two processes. The one in the wiki — this grey one — and the one that actually happens. This is the second one, and normally nobody can see it." |
| **0:12–0:30** | Click **Run**. The conversation rail fills: Maya asks for prod access, Sofia approves, Oliver objects, Sofia overrules, Noah grants. | "Five people, one access request. They're arguing, they're informal, and not one of them says 'I am now performing step four'." |
| **0:30–0:52** | Nodes appear on the canvas one at a time as messages land. | "Ariadne is reading the channel and extracting the atomic steps of work. **Nobody labelled any of this.** The activities, who performed them, the order — all of it came out of the sentences on the left." ⧫ *B: "Ariadne mines the event log into the process as it actually ran."* |
| **0:52–1:12** | Click a node. Inspector opens with the quoted messages, author, time, permalink. | "And every node is evidence. This step exists because Noah typed this sentence, at this time. Click through and you land on the message in Slack. If I can't show you the message, I don't draw the node." |
| **1:12–1:34** | Switch to overlay. Green, dashed grey, gold. Conformance number visible. | "Now compare it to the documented process. Green happened and was written down. **Grey was written down and never happens** — that's the mandatory security review. **Gold happens every single time and appears in no document.** We're at 78% conformance, and here's the message where the rule broke." Hover the violation quote. |
| **1:34–1:50** | Promote the gold node. Number counts 78 → 91. | "So repair it. That activity is real, it happens every time — promote it into the documented process, and the documentation now matches reality." ⧫ *B: skip; show the frequency filter instead.* |
| **1:50–2:00** | Wide shot of the graph. | "The process nobody wrote down, discovered from the room where the work already happens, with a citation on every claim." |

Hard rules: **nothing untested goes in the video**, one take per beat with the app pre-warmed, and
if a beat fails, cut it rather than narrate the failure.

---

## 3. The five sentences that carry it

Get these right and the rest is garnish:

1. *"Every company has two processes — the one in the wiki and the one that actually happens."*
2. *"Nobody labelled any of this."*
3. *"If I can't show you the message, I don't draw the node."*
4. *"Grey was written down and never happens. Gold happens every time and is in no document."*
5. *"It only works because it lives where the work already happens."*

Sentence 5 is the rubric's theme-alignment criterion, stated out loud. Do not leave it implied.

---

## 4. T-20 checklist

```
□ Fresh browser profile          the 5-runs-per-session cap has not been spent
□ Cookies cleared                no residue from rehearsal
□ Run it once, end to end        then reset — never demo an untried path
□ Baseline present               graph is NOT empty on load
□ Live variant introduces        at least one node or edge the baseline lacks
□ AI budget                      100/day shared — check remaining before recording
□ Slack (if wired)               bot in channel, permalinks resolve when clicked
□ Zoom 100%, 1920×1080           graph legible, no horizontal scroll
□ Close everything else          no notifications, no other tabs, no Slack sidebar
□ Screen recording tested        30 seconds, play it back, check the text is readable
```

---

## 5. Failure playbook

| If | Do |
|---|---|
| Extraction returns nothing | you are in demo B. Say "events" not "extracted steps". Nothing else changes. |
| Model budget exhausted | `/api/ask` degrades to computed statistics — **that is a feature**: "no budget, so it's showing the arithmetic instead of the prose" |
| Graph doesn't change on Run | skip to the overlay beat. Never say "it should be updating" |
| A node has no evidence | do not click it. Click one you rehearsed |
| Slack permalink 404s | don't click through. Say the evidence is the message, show the quote |
| Anything crashes | the graph never unmounts (spec 12 §7.2). Reload, jump to the beat, continue |

The rule under all of these: **never narrate a failure.** Move to the next beat.

---

## 6. Submission

### Title
**Ariadne — the agent that mines your team's real process from the channel it already happens in**

### 60 words
> Every company runs two processes: the one in the wiki, and the one that actually happens in chat.
> Ariadne watches the conversation, extracts the atomic steps of work, and builds a process graph
> where every node cites the message that proves it. Then it compares that to the documented process
> and shows you exactly where the two diverge.

### 180 words
> Every company runs two processes: the documented one, and the one that actually happens in chat.
> The second is the real one, and it's invisible — scattered across thousands of messages, never
> written down, lost when people leave.
>
> Ariadne is an agent that lives in the channel where work already happens. It reads the
> conversation, extracts the atomic steps of work as they occur, and links every one back to the
> exact message that evidenced it. Repeat occurrences consolidate into a process graph with support
> counts, variants and rework loops.
>
> It then scores that against the documented process along three dimensions — control flow, policy,
> and role — so you can see which documented steps never happen, which undocumented ones happen
> every time, and where the rules broke, quoted.
>
> The technical split matters: a model does the one thing only a model can do, turning multi-party
> conversation into a structured event log. Everything that must be reliable — the graph, the
> frequencies, the conformance arithmetic — is computed, not generated. So the graph cannot
> hallucinate, and a node you can't click through to a real message is never drawn.

### Social post
> Every company has two processes: the one in the wiki, and the one that actually happens in Slack.
>
> We built Ariadne — an agent that reads the channel, extracts the atomic steps of work, and builds
> a process graph where every node cites the message that proves it. Then it shows you where the
> documented process and reality diverge.
>
> Built at @aitinkerers "Agents, Everywhere" with @OpenAI @CopilotKit @OpenRouterAI @ExaAILabs
> @auth0 @triggerdotdev @MozillaAI ☁️ @CloudflareDev
>
> 🧵 ariadneos.com

*Tag only the sponsors we actually used. Trim the list rather than overclaim.*

---

## 7. The three questions judges will ask

**"Is this just a simulation?"**
> The conversation is generated so you can watch a week of work in ninety seconds. Everything
> downstream of it is live — the extraction, the graph, the conformance, the citations. And it reads
> the same API a real channel would. ⧫ *If Slack is wired: "type a message in the channel yourself
> and watch the graph move."*

**"How do you know the extraction is right?"**
> Every step carries the message IDs that produced it, so you can audit any node in one click. And
> each scenario declares its expected deviations up front as ground truth — we assert the observer
> found them. It's not "trust the model", it's "here's the sentence."

**"Why a graph instead of a summary?"**
> Because a summary can't tell you that a step happens in four cases out of four and appears in no
> document. Support counts, variant analysis, rework detection, and conformance arithmetic are all
> things you can only compute over a structure.

---

## 8. What we say we did not build

Volunteer this. It costs nothing and buys more credibility than it spends:

- The conversation is generated, not harvested from a real team.
- Extraction runs on a cached transcript; the live agent-to-agent generation is specced, not shipped.
- Graph editing, agent interventions and the Mastra agent layer are specced and not shipped.
- ⧫ *B only:* the event log is synthetic — the mining, the graph and the conformance are real.

A team that states its limits precisely reads as a team that knows what it built. A team that
oversells one detail loses the benefit of the doubt on everything else.
