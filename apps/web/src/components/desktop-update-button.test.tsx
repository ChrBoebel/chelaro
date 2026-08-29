import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopUpdateButton } from "./desktop-update-button";

afterEach(() => {
  delete window.financeOS;
});

describe("DesktopUpdateButton", () => {
  it("stays hidden in the browser and while no update exists", async () => {
    const { container } = render(<DesktopUpdateButton />);
    expect(container.innerHTML).toBe("");
  });

  it("downloads and installs an announced desktop update", async () => {
    let subscriber: ((state: ChelaroUpdateState) => void) | undefined;
    const download = vi.fn(async () => ({ status: "downloading", percent: 0 }) as const);
    const install = vi.fn(async () => ({ status: "installing" }) as const);
    window.financeOS = {
      platform: "darwin",
      updates: {
        getState: vi.fn(async () => ({ status: "idle" }) as const),
        download,
        install,
        subscribe(callback) {
          subscriber = callback;
          return () => {
            subscriber = undefined;
          };
        },
      },
    };
    render(<DesktopUpdateButton />);

    await waitFor(() => expect(subscriber).toBeTypeOf("function"));
    await act(async () => Promise.resolve());
    await act(async () => subscriber?.({ status: "available", version: "0.2.0" }));
    fireEvent.click(screen.getByRole("button", { name: /Update verfügbar/ }));
    expect(download).toHaveBeenCalledOnce();

    await act(async () => subscriber?.({ status: "downloaded", version: "0.2.0" }));
    fireEvent.click(screen.getByRole("button", { name: /Neu starten/ }));
    expect(install).toHaveBeenCalledOnce();
  });
});
