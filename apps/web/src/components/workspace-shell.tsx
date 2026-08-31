"use client";

import { useState } from "react";

import { BankConnectionSetup } from "@/components/bank-connection";
import { BrandMark } from "@/components/brand-mark";
import { DocumentInbox } from "@/components/document-inbox";
import { DesktopUpdateButton } from "@/components/desktop-update-button";
import { DesktopVersion } from "@/components/desktop-version";
import { FinanceAssistant } from "@/components/finance-assistant";
import { InvoiceWorkbook } from "@/components/invoice-workbook";
import { PersonalDashboard } from "@/components/personal-dashboard";
import { ThemeToggle } from "@/components/theme-toggle";

type WorkspaceView = "overview" | "assistant" | "banking" | "documents" | "workbook";

export function WorkspaceShell() {
  const [view, setView] = useState<WorkspaceView>("overview");

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-[1540px] px-4 pb-10 sm:px-7 lg:px-10">
        <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-line py-3">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9" />
            <div>
              <p className="text-sm font-semibold tracking-[-0.02em] text-ink">
                Chelaro
              </p>
              <div className="flex items-baseline gap-2 text-[11px] text-muted">
                <p>Jede Zahl. Belegt.</p>
                <DesktopVersion />
              </div>
            </div>
          </div>

          <nav
            aria-label="Arbeitsbereiche"
            className="order-3 flex w-full items-center gap-1 overflow-x-auto rounded-xl bg-surface p-1 sm:order-none sm:w-auto"
          >
            <NavigationButton
              active={view === "overview"}
              onClick={() => setView("overview")}
            >
              Übersicht
            </NavigationButton>
            <NavigationButton
              active={view === "assistant"}
              onClick={() => setView("assistant")}
            >
              Assistent
            </NavigationButton>
            <NavigationButton
              active={view === "banking"}
              onClick={() => setView("banking")}
            >
              Bank
            </NavigationButton>
            <NavigationButton
              active={view === "documents"}
              onClick={() => setView("documents")}
            >
              Dokumente
            </NavigationButton>
            <NavigationButton
              active={view === "workbook"}
              onClick={() => setView("workbook")}
            >
              Rechnungen
            </NavigationButton>
          </nav>

          <div className="flex items-center gap-2">
            <DesktopUpdateButton />
            <ThemeToggle />
          </div>
        </header>

        {view === "overview" ? (
          <PersonalDashboard />
        ) : view === "assistant" ? (
          <FinanceAssistant />
        ) : view === "banking" ? (
          <BankConnectionSetup />
        ) : view === "documents" ? (
          <DocumentInbox />
        ) : (
          <InvoiceWorkbook />
        )}
      </div>
    </main>
  );
}

function NavigationButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className="min-h-11 shrink-0 rounded-lg px-4 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring aria-[current=page]:bg-paper aria-[current=page]:text-ink aria-[current=page]:shadow-control not-aria-[current=page]:text-muted hover:text-ink"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
