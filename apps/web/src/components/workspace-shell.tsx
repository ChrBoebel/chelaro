"use client";

import { useEffect, useRef, useState } from "react";

import { BankConnectionSetup } from "@/components/bank-connection";
import { BrandMark } from "@/components/brand-mark";
import { DocumentInbox } from "@/components/document-inbox";
import { DesktopUpdateButton } from "@/components/desktop-update-button";
import { DesktopVersion } from "@/components/desktop-version";
import { FinanceAssistant } from "@/components/finance-assistant";
import { InvoiceWorkbook } from "@/components/invoice-workbook";
import { PersonalDashboard } from "@/components/personal-dashboard";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkspaceIcon } from "@/components/ui/workspace-icon";

type WorkspaceView =
  "overview" | "assistant" | "banking" | "documents" | "workbook";
const VIEWS: { id: WorkspaceView; label: string }[] = [
  { id: "overview", label: "Übersicht" },
  { id: "assistant", label: "Assistent" },
  { id: "banking", label: "Bank" },
  { id: "documents", label: "Dokumente" },
  { id: "workbook", label: "Rechnungen" },
];

export function WorkspaceShell() {
  const sidebarRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [assistantOpened, setAssistantOpened] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyContainer, setHistoryContainer] =
    useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const sidebar = sidebarRef.current;
    const focusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, summary",
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (!sidebar?.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    }
    const desktop = window.matchMedia("(min-width: 768px)");
    const onResize = () => {
      if (desktop.matches) setSidebarOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onResize);
      previous?.focus();
    };
  }, [sidebarOpen]);

  function navigate(next: WorkspaceView) {
    setView(next);
    if (next === "assistant") setAssistantOpened(true);
    setSidebarOpen(false);
  }

  return (
    <main className="workspace" data-sidebar-open={sidebarOpen}>
      {sidebarOpen ? (
        <button
          className="workspace-backdrop"
          aria-label="Seitenleiste schließen"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        role={sidebarOpen ? "dialog" : undefined}
        aria-modal={sidebarOpen || undefined}
        className="workspace-sidebar"
        id="workspace-sidebar"
        aria-label="Arbeitsplatz"
      >
        <div className="workspace-brand">
          <BrandMark className="size-16" />
          <div>
            <p className="text-[26px] font-semibold leading-tight tracking-[-0.04em] text-ink">
              Chelaro
            </p>
            <p className="mt-1 text-[11px] text-muted">Jede Zahl. Belegt.</p>
          </div>
          <button
            className="workspace-icon-button ml-auto md:hidden"
            aria-label="Seitenleiste schließen"
            onClick={() => setSidebarOpen(false)}
          >
            <WorkspaceIcon name="panel" />
          </button>
        </div>
        <nav aria-label="Arbeitsbereiche" className="workspace-nav">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <WorkspaceIcon name={id} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div
          ref={setHistoryContainer}
          className="workspace-history"
          hidden={view !== "assistant"}
        />
        <div className="workspace-sidebar-footer">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ThemeToggle />
            <DesktopUpdateButton />
          </div>
          <DesktopVersion />
        </div>
      </aside>
      <div className="workspace-body" inert={sidebarOpen}>
        <header className="workspace-toolbar">
          <button
            className="workspace-icon-button md:hidden"
            aria-controls="workspace-sidebar"
            aria-expanded={sidebarOpen}
            aria-label="Seitenleiste öffnen"
            onClick={() => setSidebarOpen(true)}
          >
            <WorkspaceIcon name="panel" />
          </button>
        </header>
        {/* Keep the event stream and in-memory drafts alive across workspace navigation. */}
        {assistantOpened ? (
          <div className="workspace-assistant" hidden={view !== "assistant"}>
            <FinanceAssistant
              historyContainer={historyContainer}
              onConversationSelect={() => setSidebarOpen(false)}
            />
          </div>
        ) : null}
        {view !== "assistant" ? (
          <div className="workspace-page">
            {view === "overview" ? (
              <PersonalDashboard />
            ) : view === "banking" ? (
              <BankConnectionSetup />
            ) : view === "documents" ? (
              <DocumentInbox />
            ) : (
              <InvoiceWorkbook />
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
