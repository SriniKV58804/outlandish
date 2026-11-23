import type { CSSProperties } from "react";

type Name =
  | "atlas"
  | "grid"
  | "list"
  | "arrow"
  | "back"
  | "next"
  | "close"
  | "drag"
  | "info"
  | "external"
  | "play"
  | "calendar"
  | "photo"
  | "instagram"
  | "tiktok";

const paths: Record<Name, React.ReactNode> = {
  atlas: (
    <>
      <ellipse cx="12" cy="12" rx="10" ry="6.4" transform="rotate(-36 12 12)" />
      <ellipse cx="12" cy="12" rx="4.4" ry="9.5" transform="rotate(39 12 12)" />
    </>
  ),
  grid: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z M4 12l8 4.5 8-4.5 M4 16l8 4.5 8-4.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  back: <path d="m14.5 5-7 7 7 7" />,
  next: <path d="m9.5 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  drag: (
    <>
      <path d="M7.5 12V7.5a1.5 1.5 0 0 1 3 0V11m0-1V5.8a1.5 1.5 0 0 1 3 0V11m0-1V7a1.5 1.5 0 0 1 3 0v5m0-1V9.3a1.5 1.5 0 0 1 3 0v4.5c0 3.6-2.4 6.2-6.1 6.2h-1.1c-2 0-3.1-1-4.3-2.6l-3.7-5a1.4 1.4 0 0 1 2-1.8l1.2 1.4Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-9v.01" />
    </>
  ),
  external: <path d="M8 5h11v11M19 5 5 19" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M4 10h16" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m4 17 5-6 4 4 3-3 4 5" />
      <circle cx="16" cy="9" r="1" />
    </>
  ),
  instagram: (
    <>
      <rect x="3.7" y="3.7" width="16.6" height="16.6" rx="4.7" />
      <circle cx="12" cy="12" r="3.7" />
      <path d="M17.2 6.9h.01" />
    </>
  ),
  tiktok: (
    <>
      <path d="M14.5 3v12a5 5 0 1 1-4-4.9v3a2.2 2.2 0 1 0 1.1 1.9V3Zm0 0c.4 2.6 2.3 4.7 5.3 5v2.8a8.8 8.8 0 0 1-5.3-2.3" />
    </>
  ),
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: Name;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.65"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
