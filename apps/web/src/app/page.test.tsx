import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

describe("Chelaro personal workspace", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
  });

  it("puts the personal finance overview first", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Dein Überblick." }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Neu erfassen" }),
    ).toBeDefined();
    expect(screen.getByLabelText("Finanzüberblick wird geladen")).toBeDefined();
  });
});
