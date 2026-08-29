import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses a saved theme and switches it persistently", () => {
    window.localStorage.setItem("finance-os-theme", "dark");

    render(<ThemeToggle />);

    const toggle = screen.getByRole("button", {
      name: "Hellen Modus aktivieren",
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Dunklen Modus aktivieren" }),
    ).toBeDefined();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("finance-os-theme")).toBe("light");
  });

  it("uses the operating-system preference until a choice is saved", () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);

    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: "Hellen Modus aktivieren" }),
    ).toBeDefined();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("finance-os-theme")).toBeNull();
  });
});
