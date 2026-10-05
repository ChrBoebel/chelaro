import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Assistant output is untrusted: no HTML, remote images, or executable URLs. */
export const AssistantMessage = memo(function AssistantMessage({
  text,
}: {
  text: string;
}) {
  return (
    <div className="assistant-prose">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="text-muted">
              {alt ? `[Bild: ${alt}]` : "[Bild]"}
            </span>
          ),
          table: ({ children }) => (
            <div className="assistant-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
