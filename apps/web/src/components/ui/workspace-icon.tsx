import type { SVGProps } from "react";

const paths = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  assistant:
    "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-5 3 1.5-6A8.5 8.5 0 1 1 21 11.5ZM8 10h8M8 14h5",
  banking: "m3 8 9-5 9 5H3ZM5 10v8m7-8v8m7-8v8M3 21h18",
  documents: "M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h6",
  workbook: "M3 4h18v16H3zM3 9h18M3 14h18M9 4v16",
  plus: "M12 5v14M5 12h14",
  panel: "M3 4h18v16H3zM9 4v16",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  down: "M12 5v14m-6-6 6 6 6-6",
  search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  check: "m5 12 4 4L19 6",
  stop: "M6 6h12v12H6z",
} as const;

export function WorkspaceIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
