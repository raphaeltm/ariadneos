# Post simulated personas into the real Slack channel

Status: in-review
Owner: Claude (Opus 5), sponsored by Roman Grebnev
Source: Session request — "can we implement the simulator". Verification of the existing code showed
the inbound Slack path was complete but nothing in the repository ever called `chat.postMessage`, so
a simulation could not reach a channel and the permalinks `server/demo/simulator.ts` synthesised
pointed at messages that were never posted.
Branch: ft/slack-simulator-posting

## Intent

Close the outbound half of Slack so a cached transcript can be performed into a real channel as six
distinct people. Ingestion, extraction and the graph continue to run live against what Slack
returns; only the authoring of the text is cached.

## Acceptance criteria

- One bot token posts as six different authors, each with their own display name and icon.
- Each message carries `session_id` and `person_id` in Slack message metadata.
- Returned permalinks match the archive URL format and resolve to the posted message.
- A missing token fails before the first post rather than part-way through a channel.
- No Slack failure throws into the request that triggered the run.

## Decisions and rationale

- **`chat:write.customize` over multiple apps or user tokens.** Six Slack apps produce the same
  visual result for three times the setup; user tokens need six invites and six OAuth installs.
  One token with per-message identity override was the only option affordable in the window.
- **Identity comes from `kb/people.json`**, which already carries `name` and `emoji` per person, so
  no avatar hosting is required and the speaker and the poster cannot drift apart.
- **Permalinks are constructed locally.** The URL is a pure function of channel and timestamp, so
  `chat.getPermalink` would double the subrequest count for no benefit.
- **Posting is sequential.** Slack orders by receipt; parallel posts would scramble the conversation
  and with it the directly-follows ordering the graph is built from. The two `await`s inside the
  loop carry `biome-ignore` comments because the rule is correct in general and wrong here.
- **`POST /api/sim/perform` returns 202 and posts via `waitUntil`.** A fourteen-message run paced at
  1.2s would otherwise hold the request near the Worker wall-clock limit, and the client is watching
  Slack and the graph rather than the response.
- **Failures degrade rather than throw.** A message that fails to post leaves that step `inferred`
  rather than `grounded`, which is the honest representation.

## Changes

- `server/slack/post.ts` — `postPersonaMessage`, `slackPermalink`, typed result union.
- `server/demo/perform.ts` — `performTranscript`, pacing at `max(1.2s, transcript delay)`.
- `server/routes/simulation.ts` — `GET /api/sim/scenarios`, `POST /api/sim/perform`.
- `server/index.ts` — mounts the routes, extends `Env` with `SlackPostEnv`.
- `tests/slack-post.test.ts` — identity override, metadata, permalink format, and the
  no-token / API-error / transport-error paths.

## Validation

- `npm run check` **not run locally**: the repository requires `node >=22.12.0` and the machine has
  v20.20.2, so dependencies could not be installed. CI on PR #85 is the gate.
- First CI run failed on two Biome rules (`noAwaitInLoops`, import sorting) and the missing work
  item record; all three are addressed in this revision.
- End-to-end posting is unverified because `SLACK_BOT_TOKEN` is not yet configured in any
  environment. Until it is, `/api/sim/perform` returns 503 by design.

## Risks and rollback

- Unverified against the live Slack API. The first real run may surface scope or channel-membership
  errors; these return as `api_error` with Slack's own message rather than failing silently.
- Posting is additive and confined to the configured channel; rollback is deleting the branch or
  unsetting `SLACK_BOT_TOKEN`, which returns the route to 503.

## Next steps

- Set `SLACK_BOT_TOKEN` and `SLACK_WORKSPACE` secrets, then perform one run against
  `#ops-war-room` and confirm six distinct authors and resolving permalinks.
- Wire `normalizeSlackObservation` to `extract()` — ingested messages are currently stored in
  `pm_message` but never mined. Deliberately out of scope here; it is a separate change.
