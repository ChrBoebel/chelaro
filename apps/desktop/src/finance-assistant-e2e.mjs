import { writeFile } from "node:fs/promises";
import path from "node:path";

const E2E_TIMEOUT_MS = 60_000;

export async function runFinanceAssistantE2e(window, { dataRoot }) {
  const resultPath = path.join(dataRoot, "finance-assistant-e2e-result.json");
  const screenshotPath = path.join(dataRoot, "finance-assistant-e2e.png");
  try {
    const initialReceivables = await window.webContents.executeJavaScript(`
      (async () => {
        const response = await fetch("/api/finance/receivables", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body?.data)) {
          throw new Error("Initial receivables could not be verified.");
        }
        return body.data;
      })()
    `, true);
    if (initialReceivables.length !== 0) throw new Error("E2E database was not isolated.");

    await clickButton(window, "Assistent");
    await waitForText(window, "Du entscheidest, was geteilt wird.");
    await clickButton(window, "Zustimmen und fortfahren");
    await waitForButton(window, "Neue Unterhaltung");
    await clickButton(window, "Neue Unterhaltung");
    await waitForText(window, "Wobei darf ich dir helfen?");

    const submitted = await window.webContents.executeJavaScript(`
      (() => {
        const field = document.querySelector("textarea[name='prompt']");
        const form = field?.closest("form");
        if (!(field instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false;
        field.value = "Synthetische Testperson schuldet mir noch Geld wegen Testpizza 10 Euro.";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
        return true;
      })()
    `, true);
    if (!submitted) throw new Error("Finance assistant prompt could not be submitted.");
    await waitForButton(window, "Senden");
    const persistedConversation = await readPersistedConversation(window);
    if (
      persistedConversation.conversations.length !== 1 ||
      persistedConversation.messages.length !== 2 ||
      persistedConversation.messages[0]?.role !== "user" ||
      persistedConversation.messages[1]?.role !== "assistant" ||
      !persistedConversation.messages[1]?.text.includes("prüfbaren Vorschlag")
    ) {
      throw new Error("The complete finance conversation was not stored locally.");
    }
    window.webContents.reload();
    await waitForButton(window, "Assistent");
    await clickButton(window, "Assistent");
    await waitForText(window, "prüfbaren Vorschlag vorbereitet");

    const beforeApproval = await window.webContents.executeJavaScript(`
      (async () => {
        const proposalResponse = await fetch("/api/finance/change-proposals?pending_only=true", {
          cache: "no-store"
        });
        const receivableResponse = await fetch("/api/finance/receivables", { cache: "no-store" });
        const proposals = await proposalResponse.json();
        const receivables = await receivableResponse.json();
        if (!proposalResponse.ok || !receivableResponse.ok) {
          throw new Error(JSON.stringify({
            proposalStatus: proposalResponse.status,
            proposals,
            receivableStatus: receivableResponse.status,
            receivables
          }));
        }
        return {
          canonical: receivables.data,
          pending: proposals.data
        };
      })()
    `, true);
    if (
      beforeApproval.canonical.length !== 0 ||
      beforeApproval.pending.length !== 1 ||
      beforeApproval.pending[0]?.action !== "receivable_create" ||
      beforeApproval.pending[0]?.receivable_id !== null ||
      beforeApproval.pending[0]?.expected_version !== null ||
      beforeApproval.pending[0]?.status !== "pending" ||
      beforeApproval.pending[0]?.debtor_name !== "Synthetische Testperson" ||
      beforeApproval.pending[0]?.payload?.original_amount !== "10.00" ||
      beforeApproval.pending[0]?.payload?.currency !== "EUR" ||
      beforeApproval.pending[0]?.payload?.description !== "Testpizza" ||
      beforeApproval.pending[0]?.payload?.due_date !== null
    ) {
      throw new Error("The finance assistant bypassed or failed the create-proposal boundary.");
    }

    await clickButton(window, "Übersicht");
    await waitForText(window, "1 KI-Vorschlag");
    await clickButton(window, "1 KI-Vorschlag");
    await waitForButton(window, "Übernehmen");
    const reviewText = await window.webContents.executeJavaScript(
      "document.body?.innerText ?? ''",
      true,
    );
    const normalizedReviewText = reviewText.toLocaleLowerCase("de-DE");
    if (
      !normalizedReviewText.includes("offenen betrag anlegen") ||
      !normalizedReviewText.includes("testpizza") ||
      normalizedReviewText.includes("offenen betrag ansehen")
    ) {
      throw new Error("The create proposal review did not show the expected safe state.");
    }
    await clickButton(window, "Übernehmen");
    const afterApproval = await waitForApprovedReceivable(window);
    if (
      afterApproval.pending.length !== 0 ||
      afterApproval.detail.debtor_name !== "Synthetische Testperson" ||
      afterApproval.detail.original_amount !== "10.00" ||
      afterApproval.detail.currency !== "EUR" ||
      afterApproval.detail.description !== "Testpizza" ||
      afterApproval.detail.history?.[0]?.event_type !== "created" ||
      afterApproval.detail.history?.[0]?.actor_type !== "agent" ||
      afterApproval.detail.history?.[0]?.proposal_id !== beforeApproval.pending[0].id
    ) {
      throw new Error("Owner approval did not create the exact audited receivable.");
    }

    const image = await window.webContents.capturePage();
    await writeFile(screenshotPath, image.toPNG(), { mode: 0o600 });
    const result = {
      assistantAnswerStreamed: true,
      completeConversationPersisted: true,
      conversationVisibleAfterRendererRestart: true,
      canonicalDataUnchangedBeforeApproval: true,
      consentCompleted: true,
      directFinanceToolCallCreatedProposal: true,
      sharedCodexLoginReused: true,
      financeToolProposalCreated: true,
      ownerApprovalCreatedReceivable: true,
      receivableAuditLinkedToProposal: true,
      syntheticDataOnly: true,
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return result;
  } catch (error) {
    const uiText = await window.webContents.executeJavaScript(
      "document.body?.innerText.slice(0, 4000) ?? ''",
      true,
    ).catch(() => "");
    const image = await window.webContents.capturePage().catch(() => undefined);
    if (image) await writeFile(screenshotPath, image.toPNG(), { mode: 0o600 });
    const result = {
      error: error instanceof Error ? error.message : String(error),
      syntheticDataOnly: true,
      uiText,
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    throw error;
  }
}

async function readPersistedConversation(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const conversationsResponse = await fetch("/api/assistant/conversations", {
        cache: "no-store"
      });
      const conversations = await conversationsResponse.json();
      if (!conversationsResponse.ok || conversations.data.length !== 1) {
        throw new Error("Conversation list could not be loaded.");
      }
      const messagesResponse = await fetch(
        "/api/assistant/conversations/" + encodeURIComponent(conversations.data[0].id) + "/messages",
        { cache: "no-store" }
      );
      const messages = await messagesResponse.json();
      if (!messagesResponse.ok) throw new Error("Conversation messages could not be loaded.");
      return { conversations: conversations.data, messages: messages.data };
    })()
  `, true);
}

async function clickButton(window, label) {
  const clicked = await window.webContents.executeJavaScript(`
    (() => {
      const label = ${JSON.stringify(label)};
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === label);
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()
  `, true);
  if (!clicked) throw new Error(`E2E button was unavailable: ${label}`);
}

async function waitForButton(window, label, timeoutMs = E2E_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const available = await window.webContents.executeJavaScript(`
      [...document.querySelectorAll("button")].some((candidate) =>
        candidate.textContent?.trim() === ${JSON.stringify(label)} &&
        candidate instanceof HTMLButtonElement &&
        !candidate.disabled
      )
    `, true);
    if (available) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E button did not appear: ${label}`);
}

async function waitForApprovedReceivable(window, timeoutMs = E2E_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const receivablesResponse = await fetch("/api/finance/receivables", { cache: "no-store" });
        const pendingResponse = await fetch("/api/finance/change-proposals?pending_only=true", {
          cache: "no-store"
        });
        const receivables = await receivablesResponse.json();
        const pending = await pendingResponse.json();
        if (!receivablesResponse.ok || !pendingResponse.ok) {
          throw new Error("Approved receivable could not be loaded.");
        }
        if (receivables.data.length !== 1 || pending.data.length !== 0) return null;
        const detailResponse = await fetch(
          "/api/finance/receivables/" + encodeURIComponent(receivables.data[0].id),
          { cache: "no-store" }
        );
        const detail = await detailResponse.json();
        if (!detailResponse.ok) throw new Error("Approved receivable detail could not be loaded.");
        return { detail: detail.data, pending: pending.data };
      })()
    `, true);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The approved receivable did not become canonical in time.");
}

async function waitForText(window, text, timeoutMs = E2E_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await window.webContents.executeJavaScript(
      `document.body?.innerText.includes(${JSON.stringify(text)}) ?? false`,
      true,
    );
    if (visible) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E text did not appear: ${text}`);
}
