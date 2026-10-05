import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantMessage } from "./assistant-message";

afterEach(cleanup);

describe("assistant markdown", () => {
  it("renders financial tables and lists as readable semantic content", () => {
    render(
      <AssistantMessage
        text={
          "## Beispiel\n\n| Posten | Betrag |\n| --- | --- |\n| Test | 12,50 EUR |\n\n- **Prüfen**\n- Bestätigen"
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Beispiel" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "12,50 EUR" })).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("never executes HTML, loads remote images, or links to executable or local URLs", () => {
    const { container } = render(
      <AssistantMessage
        text={
          '<script>alert(1)</script>\n\n<img src="https://example.com/track" onerror="alert(1)">\n\n![Tracking](https://example.com/track)\n\n[Bad](javascript:alert%281%29) [File](file:///private/test) [Local](/api/finance) [Data](data:text/html,test) [Protocol](//example.com) [Safe](https://example.com)'
        }
      />,
    );
    expect(container.querySelector("script, img, iframe")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Safe" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
