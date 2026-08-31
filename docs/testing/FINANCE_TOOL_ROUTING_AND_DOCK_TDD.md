# Finance tool routing and Dock helper: TDD evidence

Date: 2026-08-31

## User journeys

1. The owner writes a natural request such as “Synthetische Testperson schuldet mir noch Geld wegen
   Testpizza 10 Euro.”
2. GPT-5.6 calls the bounded proposal tool without asking for an optional due date or confirmation.
3. Chelaro creates one pending proposal, leaves canonical finance data unchanged, and applies the
   change only after explicit owner review.
4. Starting packaged Chelaro shows only Chelaro in the Dock; the embedded Python API remains a
   background executable.

All E2E values are synthetic and every run uses a new temporary SQLite database.

## RED checkpoints

- `3acc08c test(runtime): reproduce finance routing and Dock regressions` captured the forbidden
  `console=False` PyInstaller mode and missing direct-tool instruction.
- `7143703 test(agent-host): require isolated code-mode routing` proved that the App Server launch
  still disabled the host required by GPT-5.6.
- A minimal authenticated live turn with one `finance_ping` function returned
  `code-mode host is disabled` and emitted no tool request.

## GREEN checkpoints

- `050d1e9 fix(desktop): keep embedded API out of macOS Dock` selects PyInstaller's console
  bootloader, which does not register the helper as a GUI application.
- `d03832a fix(agent-host): enable isolated finance tool routing` enables only
  `features.code_mode_host`, keeps every non-finance capability disabled, and constrains the model
  to `tools.finance_*` calls.
- The same minimal authenticated live turn emitted `item/tool/call` for `finance_ping` and returned
  `pong`.

## Automated results

```text
pnpm --filter @finance-os/agent-host test
```

Result: 112 passed, 0 failed.

```text
pnpm package:desktop:dir
```

Result: the unsigned local arm64 application package built successfully, including the embedded API,
standalone web runtime, and Agent Host.

The packaged real-model E2E passed twice and verified:

- existing Codex login reuse;
- streamed assistant output;
- exactly one `receivable_create` proposal;
- zero canonical receivables before approval;
- owner approval creating the exact EUR 10.00 receivable;
- an audit event linked to the proposal;
- `syntheticDataOnly: true`.

While that packaged E2E was running, the embedded `finance-os-api` process was present and
`lsappinfo` reported no application registration for its executable path:

```text
DOCK_HELPER_REGISTERED=no
```

The local package is intentionally unsigned verification output and is not a public release artifact.
