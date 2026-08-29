import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/components/ui/page-header";

describe("PageHeader", () => {
  it("connects the page title and keeps supporting actions accessible", () => {
    render(
      <PageHeader
        titleId="documents-title"
        eyebrow="Dokumentenarchiv"
        title="Deine Belege."
        description="Originale bleiben unverändert."
        actions={<button type="button">Dateien auswählen</button>}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Deine Belege." }).id).toBe(
      "documents-title",
    );
    expect(screen.getByRole("button", { name: "Dateien auswählen" })).toBeDefined();
  });
});
