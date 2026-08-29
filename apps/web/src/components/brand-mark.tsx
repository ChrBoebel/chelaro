export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[30%] border border-current font-semibold leading-none ${className}`}
    >
      <span className="text-[0.55em]">C</span>
    </span>
  );
}
