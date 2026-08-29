import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("uses a safe default type and the requested semantic style", () => {
    render(<Button variant="review" size="regular">KI-Vorschlag prüfen</Button>);

    const button = screen.getByRole("button", { name: "KI-Vorschlag prüfen" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("text-review");
    expect(button.className).toContain("text-sm");
  });
});
