import type { ReactNode } from "react";

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
  titleId,
}: {
  actions?: ReactNode;
  description: ReactNode;
  eyebrow: string;
  title: string;
  titleId: string;
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-accent">
          {eyebrow}
        </p>
        <h1
          id={titleId}
          className="text-balance text-[clamp(2.25rem,5vw,4.5rem)] font-medium leading-[0.95] tracking-[-0.055em] text-ink"
        >
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-muted sm:text-base">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
