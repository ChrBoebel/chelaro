import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "@/components/ui/status-badge";

describe("StatusBadge", () => {
  it("renders review state without implying confirmation", () => {
    render(<StatusBadge tone="review">KI-Vorschlag</StatusBadge>);

    const badge = screen.getByText("KI-Vorschlag");
    expect(badge.className).toContain("text-review");
    expect(badge.className).not.toContain("text-confirmed");
  });
});
