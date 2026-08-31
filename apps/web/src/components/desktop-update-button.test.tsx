import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopUpdateButton } from "./desktop-update-button";

afterEach(() => {
  cleanup();
  delete window.financeOS;
});

function desktopBridge(initialState: ChelaroUpdateState = { status: "idle" }) {
  let subscriber: ((state: ChelaroUpdateState) => void) | undefined;
  const bridge = {
    platform: "darwin",
    runtime: { getVersion: vi.fn(async () => "0.3.6") },
    updates: {
      getState: vi.fn(async () => initialState),
      check: vi.fn(async () => initialState),
      download: vi.fn(async () => ({ status: "downloading", version: "0.3.0", percent: 0 }) as const),
      openInstaller: vi.fn(async () => ({ status: "downloaded", version: "0.3.0" }) as const),
      openReleasePage: vi.fn(async () => initialState),
      subscribe(callback: (state: ChelaroUpdateState) => void) {
        subscriber = callback;
        return () => {
          subscriber = undefined;
        };
      },
    },
  } satisfies NonNullable<Window["financeOS"]>;
  return { bridge, publish: (state: ChelaroUpdateState) => act(async () => subscriber?.(state)) };
}

describe("DesktopUpdateButton", () => {
  it("stays hidden in the browser and while no update exists", async () => {
    const { container } = render(<DesktopUpdateButton />);
    expect(container.innerHTML).toBe("");
  });

  it("guides the user from update notice to a verified manual DMG install", async () => {
    const harness = desktopBridge();
    window.financeOS = harness.bridge;
    render(<DesktopUpdateButton />);

    await waitFor(() => expect(harness.bridge.updates.getState).toHaveBeenCalledOnce());
    await harness.publish({ status: "available", version: "0.3.0" });
    fireEvent.click(screen.getByRole("button", { name: /Update 0.3.0 verfügbar/ }));

    expect(screen.getByRole("dialog", { name: /Chelaro 0.3.0 ist verfügbar/ })).toBeTruthy();
    expect(screen.getByText(/Größe und SHA-256-Prüfsumme/)).toBeTruthy();
    expect(screen.getByText(/Deine lokalen Daten bleiben/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "DMG herunterladen" }));
    expect(harness.bridge.updates.download).toHaveBeenCalledOnce();

    await harness.publish({ status: "downloading", version: "0.3.0", percent: 42 });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /DMG wird geladen \(42 %\)/ }).disabled).toBe(true);

    await harness.publish({ status: "downloaded", version: "0.3.0" });
    expect(screen.getByRole("status").textContent).toMatch(/Download geprüft/);
    fireEvent.click(screen.getByRole("button", { name: "DMG öffnen" }));
    expect(harness.bridge.updates.openInstaller).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Was ist neu?" }));
    expect(harness.bridge.updates.openReleasePage).toHaveBeenCalledOnce();
  });

  it("explains a failed verification and lets the user retry safely", async () => {
    const harness = desktopBridge({
      status: "error",
      stage: "download",
      version: "0.3.0",
    });
    window.financeOS = harness.bridge;
    render(<DesktopUpdateButton />);

    const notice = await screen.findByRole("button", { name: /Update 0.3.0 verfügbar/ });
    fireEvent.click(notice);
    expect(screen.getByRole("alert").textContent).toMatch(/keine Datei zur Installation freigegeben/);
    fireEvent.click(screen.getByRole("button", { name: "Download erneut versuchen" }));
    expect(harness.bridge.updates.download).toHaveBeenCalledOnce();
  });
});
