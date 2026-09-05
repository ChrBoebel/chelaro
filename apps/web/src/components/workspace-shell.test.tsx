import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./workspace-shell";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock("./finance-assistant", () => ({
  FinanceAssistant: function Assistant() {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      lifecycle.mounted();
      return lifecycle.unmounted;
    }, []);
    return (
      <input
        aria-label="Chatentwurf"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace navigation", () => {
  it("opens the assistant lazily and preserves its mounted state and draft across finance views", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<WorkspaceShell />);
    expect(lifecycle.mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Assistent" }));
    fireEvent.change(screen.getByLabelText("Chatentwurf"), {
      target: { value: "Entwurf behalten" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dokumente" }));
    expect(screen.queryByRole("textbox", { name: "Chatentwurf" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assistent" }));
    expect(
      (screen.getByRole("textbox", { name: "Chatentwurf" }) as HTMLInputElement)
        .value,
    ).toBe("Entwurf behalten");
    expect(lifecycle.mounted).toHaveBeenCalledTimes(1);
    expect(lifecycle.unmounted).not.toHaveBeenCalled();
  });
});
