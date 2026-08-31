# ADR 0014: Choose the assistant model, effort, and service tier explicitly

Status: Accepted · 1 September 2026

## Context

Chelaro never sent `model`, `model_reasoning_effort`, or `serviceTier` to the Codex App Server. Per
ADR 0011 the assistant runs against the owner's real `CODEX_HOME`, so Codex resolved all three from
the owner's personal `~/.codex/config.toml`. A machine configured for coding work therefore ran the
finance assistant on that configuration — verified against the pinned App Server, a thread started
with no model parameters reported back `model: gpt-5.6-sol`, `reasoningEffort: high`,
`serviceTier: priority`. None of that was a Chelaro decision, none of it was visible in the product,
and editing an unrelated config file silently changed the assistant.

This matters beyond determinism. ADR 0012 records that GPT-5.6 routes tool calls through Code Mode
while earlier models call the finance functions directly. The tool-routing path is therefore a
property of the model, and the provider-edge manifest gate in ADR 0010 had only ever been exercised
against whichever model the test configuration happened to name.

Owners also asked to control response speed and depth, which the catalog exposes as reasoning effort
and as the `priority` service tier that Codex itself labels "Fast — 1.5x speed, increased usage".

## Decision

- Send `model`, `config.model_reasoning_effort`, and `serviceTier` on every `thread/start` and
  `thread/resume`. Nothing about the model configuration is inherited from `CODEX_HOME`.
- Verify the configuration from the thread response. The App Server accepts an unknown model,
  effort, or tier **without an error** and reports a substituted or `null` value instead — measured
  on the pinned CLI, including under `--strict-config`. A thread counts as configured only when it
  echoes back exactly what was requested; otherwise it is rejected as an unsafe configuration.
- Offer only models whose provider-edge manifest was verified. `FINANCE_SUPPORTED_MODELS` is
  intersected with the live `model/list` catalog, and `finance-provider-manifest.test.ts` runs once
  per allowlisted model.
- Exclude the GPT-5.6 family, `gpt-5.6-luna` included. Beyond the Code Mode `exec` router that
  ADR 0012 permits, `gpt-5.6-sol` and `gpt-5.6-terra` declare `collaboration`, `spawn_agent`,
  `send_message`, `followup_task`, `interrupt_agent`, `list_agents`, and `wait_agent` at the
  provider edge. The pinned App Server offers no way to remove them: `features.collaboration =
  false` is rejected under `--strict-config`, and `features.code_mode_host = false` changes
  nothing. ADR 0010's stop condition applies. `gpt-5.6-luna` is milder — it declares only `exec`,
  `functions`, and `wait` — but `wait` is an agent-orchestration primitive that is neither one of
  the eight finance functions nor part of the router ADR 0012 sanctioned, and it buys the finance
  assistant nothing that `gpt-5.5` does not already do. Admitting it would mean weakening ADR 0010's
  provider-edge rule for no product gain, so it stays out until the pinned App Server can remove
  the tool. The first release therefore ships `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`, which expose
  exactly the eight finance functions.
- Default new conversations to `gpt-5.5` at `medium` effort with Fast Mode off. Fast Mode increases
  usage, so it is opted into rather than inherited.
- Expose model, effort, and Fast Mode in the assistant UI. Effort options and the Fast Mode switch
  come from the catalog entry of the selected model, so a model without service tiers shows no
  switch.
- Bind the configuration to the conversation, not to the application. It is stored next to the
  provider thread and reused on resume, so reopening a conversation cannot silently continue its
  history under a different model. `provider_bound` is appended only for a new or changed binding.
- Treat `model/rerouted` and `model/verification` as forbidden notifications. A silent provider-side
  model change invalidates the verified thread configuration.
- Show what the conversation runs on and what it costs. The bound model, effort, and Fast Mode stay
  visible in the chat header, and `thread/tokenUsage/updated` is projected into the snapshot so the
  increased usage Fast Mode buys is measurable rather than assumed. `contextCompaction` items and
  the deprecated `thread/compacted` notification are accepted and counted: a conversation that
  ADR 0013 keeps alive indefinitely has to survive Codex condensing its own history.

## Consequences

The assistant's model, depth, and speed are Chelaro decisions, visible in the product, recorded per
conversation, and re-verified on every thread. Changing `~/.codex/config.toml` no longer affects it.

Existing conversations predate explicit selection; the migration backfills them with the new default
and they are re-bound on the next resume. Owners on the machine tested above will notice a change
from GPT-5.6-Sol at high effort on the priority tier to GPT-5.5 at medium effort on the standard
tier — a deliberate consequence of removing the inherited configuration and of the provider-edge
finding.

Adding a model requires a green provider-edge manifest run for that model. Admitting any member of
the GPT-5.6 family requires either an App Server that can restrict its tool manifest or a new ADR
that amends ADR 0010's provider-edge rule.

Consent is unchanged. The provider, the transferred data categories, and the notice all stay the
same, so no new consent version is required.
