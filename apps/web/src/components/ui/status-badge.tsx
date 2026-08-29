import type { HTMLAttributes, ReactNode } from "react";

type StatusTone = "neutral" | "review" | "confirmed" | "risk" | "accent";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-line bg-surface text-muted",
  review: "border-review/20 bg-review/8 text-review",
  confirmed: "border-confirmed/20 bg-confirmed/8 text-confirmed",
  risk: "border-danger/20 bg-danger/8 text-danger",
  accent: "border-accent/20 bg-accent/8 text-accent",
};

export function StatusBadge({
  children,
  className = "",
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; tone?: StatusTone }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-pill border px-2.5 py-1 text-[11px] font-semibold leading-none ${toneClasses[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
