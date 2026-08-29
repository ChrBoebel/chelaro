import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentInbox } from "./document-inbox";

describe("DocumentInbox", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "0198f558-5fb0-7df7-b8f0-78ad4e12d2bb",
              filename: "Strom August.pdf",
              content_type: "application/pdf",
              size_bytes: 2048,
              sha256:
                "7881c8fd533e7f2eb0de7b487abc3851b8fd65b670818fba34e47f6776b9f169",
              status: "stored",
              created_at: "2026-08-13T08:00:00Z",
              download_url: "/api/v1/documents/id/content",
            },
          ],
          meta: { has_next: false, next_cursor: null },
        }),
      }),
    );
  });

  it("renders a stored document with an accessible download action", async () => {
    render(<DocumentInbox />);

    expect(await screen.findByText("Strom August.pdf")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Strom August.pdf herunterladen" }),
    ).toBeDefined();
    expect(screen.getByText("1 Dokument")).toBeDefined();
  });
});
