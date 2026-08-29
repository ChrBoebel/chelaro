export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 bg-contain bg-center bg-no-repeat ${className}`}
      style={{ backgroundImage: 'url("/brand/chelaro-icon.svg")' }}
    />
  );
}
