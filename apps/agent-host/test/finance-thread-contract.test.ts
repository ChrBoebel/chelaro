import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FINANCE_DYNAMIC_TOOLS,
  FINANCE_TOOL_CONTRACT_DIGEST,
  financeToolContractDigest,
} from "../src/finance-tool-contract.js";
import {
  FINANCE_DISABLED_CODEX_FEATURES,
  FinanceThreadContractError,
  assertFinanceThreadStartParams,
  buildFinanceInitializeParams,
  buildFinanceThreadStartParams,
  configuredMcpServerNames,
} from "../src/finance-thread-contract.js";

test("finance thread opts into only the required experimental API", () => {
  assert.deepEqual(buildFinanceInitializeParams("0.1.0"), {
    clientInfo: { name: "finance-os", title: "Chelaro Finanzassistent", version: "0.1.0" },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      mcpServerOpenaiFormElicitation: false,
      optOutNotificationMethods: null,
      extensions: null,
    },
  });
  assert.throws(() => buildFinanceInitializeParams("development"), FinanceThreadContractError);
});

test("finance thread has no environment and exactly the immutable finance namespace", () => {
  const params = buildFinanceThreadStartParams("gpt-5.6");
  assert.deepEqual(params.environments, []);
  assert.equal(params.dynamicTools, FINANCE_DYNAMIC_TOOLS);
  assert.equal(Object.isFrozen(params.dynamicTools), true);
  assert.equal(Object.isFrozen(params.dynamicTools[0]), true);
  assert.equal(Object.isFrozen(params.dynamicTools[0]?.type === "namespace" ? params.dynamicTools[0].tools[0]?.inputSchema : null), true);
  assert.equal(financeToolContractDigest(), FINANCE_TOOL_CONTRACT_DIGEST);
  assert.doesNotThrow(() => assertFinanceThreadStartParams(params));
});

test("finance thread disables every non-finance capability and contains finance-only instructions", () => {
  const params = buildFinanceThreadStartParams();
  const config = params.config as Record<string, unknown>;
  const features = config.features as Record<string, unknown>;
  assert.deepEqual(Object.keys(features).sort(), [...FINANCE_DISABLED_CODEX_FEATURES].sort());
  assert.equal(Object.values(features).every((value) => value === false), true);
  assert.equal(config.web_search, "disabled");
  assert.deepEqual(config.mcp_servers, {});
  assert.deepEqual(config.orchestrator, {
    mcp: { enabled: false },
    skills: { enabled: false },
  });
  assert.deepEqual(config.skills, {
    bundled: { enabled: false },
    include_instructions: false,
  });
  assert.deepEqual(config.tools, {
    experimental_request_user_input: { enabled: false },
    update_plan: { enabled: false },
  });
  assert.match(params.baseInstructions ?? "", /kein Coding-Agent/);
  assert.match(params.baseInstructions ?? "", /untrusted Daten/);
  assert.match(params.baseInstructions ?? "", /prüfpflichtige Vorschläge/);
  assert.match(params.developerInstructions ?? "", /exakt aus der Nutzereingabe/);
  assert.match(params.developerInstructions ?? "", /ohne Markdown-Markierungen/);
});

test("finance thread disables every MCP inherited from the shared Codex home", () => {
  const names = configuredMcpServerNames({
    config: { mcp_servers: { local_docs: { command: "unsafe" }, remote_data: { url: "https://example.invalid" } } },
    layers: null,
    origins: {},
  });
  assert.deepEqual(names, ["local_docs", "remote_data"]);
  const params = buildFinanceThreadStartParams(undefined, names);
  assert.deepEqual(params.config?.mcp_servers, {
    local_docs: { enabled: false },
    remote_data: { enabled: false },
  });
  assert.doesNotThrow(() => assertFinanceThreadStartParams(params));
  assert.throws(
    () => configuredMcpServerNames({ config: { mcp_servers: { "invalid.name": {} } } }),
    FinanceThreadContractError,
  );
});

test("finance thread validation rejects extra fields, environments, and changed config", () => {
  const params = buildFinanceThreadStartParams();
  for (const invalid of [
    { ...params, cwd: "/workspace" },
    { ...params, environments: [{ environmentId: "local", cwd: "/workspace" }] },
    { ...params, selectedCapabilityRoots: [] },
    { ...params, config: { ...params.config, web_search: "live" } },
    {
      ...params,
      config: {
        ...params.config,
        features: { ...(params.config?.features as object), shell_tool: true },
      },
    },
  ]) {
    assert.throws(() => assertFinanceThreadStartParams(invalid), FinanceThreadContractError);
  }
  assert.throws(() => buildFinanceThreadStartParams("invalid model name"), FinanceThreadContractError);
});
