"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export function DesktopUpdateButton() {
  const [state, setState] = useState<ChelaroUpdateState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  useEffect(() => {
    const updates = window.financeOS?.updates;
    if (!updates) return;

    let active = true;
    void updates.getState().then((nextState) => {
      if (active) setState(nextState);
    });
    const unsubscribe = updates.subscribe((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const visible = state && (
    ["available", "downloading", "downloaded"].includes(state.status) ||
    (state.status === "error" && Boolean(state.version))
  );
  if (!visible) return null;

  const version = "version" in state ? state.version : undefined;
  const downloading = state.status === "downloading";
  const label = downloading ? `Update ${state.percent}%` : `Update${version ? ` ${version}` : ""}`;

  return (
    <>
      <button
        type="button"
        aria-label={`Update${version ? ` ${version}` : ""} verfügbar`}
        aria-live="polite"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(20,25,20,0.16)] transition-[background-color,opacity] hover:bg-[color-mix(in_srgb,var(--accent)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => setDialogOpen(true)}
      >
        <DownloadIcon />
        <span>{label}</span>
        <span className="sr-only">verfügbar</span>
      </button>

      {dialogOpen ? (
        <UpdateDialog state={state} onClose={closeDialog} />
      ) : null}
    </>
  );
}

function UpdateDialog({ state, onClose }: { state: ChelaroUpdateState; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  const updates = window.financeOS?.updates;
  const version = "version" in state ? state.version : undefined;
  const downloading = state.status === "downloading";
  const downloaded = state.status === "downloaded";
  const downloadFailed = state.status === "error" && state.stage === "download";
  const openFailed = state.status === "error" && state.stage === "open";

  const runPrimaryAction = () => {
    if (!updates) return;
    if (downloaded || openFailed) void updates.openInstaller();
    else if (!downloading) void updates.download();
  };

  const primaryLabel = downloading
    ? `DMG wird geladen (${state.percent} %)`
    : downloaded || openFailed
      ? "DMG öffnen"
      : downloadFailed
        ? "Download erneut versuchen"
        : "DMG herunterladen";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-update-title"
        tabIndex={-1}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-paper p-5 shadow-[0_28px_90px_rgba(10,15,10,0.3)] outline-none sm:rounded-3xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Kostenloses Update
            </p>
            <h2 id="desktop-update-title" className="mt-1 text-xl font-semibold tracking-[-0.03em] text-ink">
              Chelaro {version} ist verfügbar
            </h2>
          </div>
          <button
            type="button"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-xl text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Update-Dialog schließen"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <p className="mt-4 text-sm leading-6 text-muted">
          Chelaro lädt die Installationsdatei direkt vom offiziellen GitHub-Release und prüft vor
          dem Öffnen Größe und SHA-256-Prüfsumme.
        </p>

        <ol className="mt-5 space-y-3" aria-label="Installationsschritte">
          <InstallStep number="1" active={!downloaded}>DMG herunterladen und prüfen</InstallStep>
          <InstallStep number="2" active={downloaded || openFailed}>DMG öffnen und Chelaro nach „Programme“ ziehen</InstallStep>
          <InstallStep number="3">Vorhandene App ersetzen und Chelaro neu starten</InstallStep>
        </ol>

        {downloaded ? (
          <p className="mt-4 rounded-xl border border-confirmed/25 bg-confirmed/8 p-3 text-sm text-confirmed" role="status">
            Download geprüft. Öffne jetzt die DMG und ersetze Chelaro im Programme-Ordner.
          </p>
        ) : downloadFailed ? (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/8 p-3 text-sm text-danger" role="alert">
            Die DMG konnte nicht sicher heruntergeladen oder geprüft werden. Es wurde keine Datei zur Installation freigegeben.
          </p>
        ) : openFailed ? (
          <p className="mt-4 rounded-xl border border-danger/25 bg-danger/8 p-3 text-sm text-danger" role="alert">
            Die geprüfte DMG konnte nicht geöffnet werden. Du kannst es erneut versuchen.
          </p>
        ) : null}

        <p className="mt-4 text-xs leading-5 text-muted">
          Falls macOS die neue Version beim ersten Start blockiert: Chelaro im Finder mit Rechtsklick
          auswählen und „Öffnen“ bestätigen. Deine lokalen Daten bleiben beim Ersetzen der App erhalten.
        </p>

        <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Button size="regular" disabled={downloading} onClick={runPrimaryAction}>
            {primaryLabel}
          </Button>
          <Button size="regular" variant="secondary" onClick={() => void updates?.openReleasePage()}>
            Was ist neu?
          </Button>
        </div>
        <button
          type="button"
          className="mt-3 min-h-11 w-full rounded-xl text-sm font-semibold text-muted hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onClose}
        >
          Später erinnern
        </button>
      </section>
    </div>
  );
}

function InstallStep({
  active = false,
  children,
  number,
}: {
  active?: boolean;
  children: string;
  number: string;
}) {
  return (
    <li className="flex items-center gap-3 text-sm text-foreground">
      <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${active ? "bg-accent text-white" : "bg-surface text-muted"}`}>
        {number}
      </span>
      <span>{children}</span>
    </li>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current">
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
