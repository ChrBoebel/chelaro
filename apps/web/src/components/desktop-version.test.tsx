import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopVersion } from "./desktop-version";

afterEach(() => {
  cleanup();
  delete window.financeOS;
});

describe("DesktopVersion", () => {
  it("shows the version reported by the installed Electron application", async () => {
    window.financeOS = {
      platform: "darwin",
      runtime: { getVersion: vi.fn(async () => "0.3.6") },
      updates: {
        getState: vi.fn(),
        check: vi.fn(),
        download: vi.fn(),
        openInstaller: vi.fn(),
        openReleasePage: vi.fn(),
        subscribe: vi.fn(),
      },
    };

    render(<DesktopVersion />);

    await waitFor(() => {
      const version = screen.getByLabelText("Installierte Version 0.3.6");
      expect(version.tagName).toBe("FOOTER");
      expect(version.textContent).toBe("Chelaro · Version 0.3.6");
    });
  });

  it("stays hidden outside the desktop application", () => {
    const { container } = render(<DesktopVersion />);

    expect(container.innerHTML).toBe("");
  });
});
