import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet" | "review" | "danger";
type ButtonSize = "default" | "regular" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-paper shadow-control hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40",
  secondary:
    "border border-line bg-paper text-ink hover:border-accent/35 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40",
  quiet: "text-muted hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
  review:
    "border border-review/25 bg-review/8 text-review hover:bg-review/12 disabled:cursor-not-allowed disabled:opacity-40",
  danger:
    "border border-line bg-paper text-muted hover:border-danger/25 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "min-h-11 px-4 text-xs",
  regular: "min-h-11 px-5 text-sm",
  icon: "size-11 shrink-0 px-0 text-base",
};

export function Button({
  className = "",
  size = "default",
  type = "button",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  return (
    <button
      type={type}
      className={`rounded-control font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
