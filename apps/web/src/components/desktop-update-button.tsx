"use client";

import { useEffect, useState } from "react";

export function DesktopUpdateButton() {
  const [state, setState] = useState<ChelaroUpdateState | null>(null);

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

  if (!state || !["available", "downloading", "downloaded", "installing"].includes(state.status)) {
    return null;
  }

  const downloading = state.status === "downloading";
  const installing = state.status === "installing";
  const label =
    state.status === "available"
      ? "Update verfügbar"
      : downloading
        ? `Update ${state.percent}%`
        : installing
          ? "Update wird installiert …"
          : "Neu starten & installieren";

  const handleClick = () => {
    const updates = window.financeOS?.updates;
    if (!updates) return;
    if (state.status === "available") void updates.download();
    if (state.status === "downloaded") void updates.install();
  };

  return (
    <button
      type="button"
      aria-live="polite"
      disabled={downloading || installing}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-3.5 text-xs font-semibold text-white shadow-[0_1px_2px_rgba(20,25,20,0.16)] transition-[background-color,opacity] hover:bg-[color-mix(in_srgb,var(--accent)_88%,black)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-75"
      onClick={handleClick}
    >
      <DownloadIcon />
      <span>{label}</span>
      {"version" in state && state.version ? (
        <span className="sr-only">Version {state.version}</span>
      ) : null}
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current">
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
