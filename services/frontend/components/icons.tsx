/** 24px line icons; they inherit the text colour. */
export function Icon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
    >
      <path d={path} />
    </svg>
  );
}

export const ICONS = {
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  send: "M20.5 3.5 3.8 9.6c-.9.3-.9 1.6 0 1.9l6.3 2.4 2.4 6.3c.3.9 1.6.9 1.9 0l6.1-16.7z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M18 6 6 18M6 6l12 12",
  plus: "M12 5v14M5 12h14",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  canvas: "M3 3h18v18H3zM3 9h18M9 21V9",
  sidebar: "M3 4h18v16H3zM9 4v16",
  code: "m16 18 6-6-6-6M8 6l-6 6 6 6",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
};

const FILE_KINDS = {
  csv: { label: "CSV", color: "#00957d" },
  json: { label: "JSON", color: "#7a5cc7" },
  md: { label: "MD", color: "#009ee0" },
  txt: { label: "TXT", color: "#5b6563" },
} as const;
export type FileKind = keyof typeof FILE_KINDS;

export const fileKind = (name: string): FileKind => {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === "csv" || ext === "json" || ext === "md" ? ext : "txt";
};

/** Document glyph with a coloured type tag (landing attachments). */
export function FileIcon({ name }: { name: string }) {
  const kind = FILE_KINDS[fileKind(name)];
  return (
    <svg aria-hidden="true" viewBox="0 0 28 32" className="file-icon" data-kind={kind.label}>
      <path d="M4 1h14l7 7v22a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="#fff" stroke="#c9d1cf" />
      <path d="M18 1v6a1 1 0 0 0 1 1h6" fill="none" stroke="#c9d1cf" />
      <rect x="1" y="17" width={kind.label.length > 3 ? 24 : 20} height="10" rx="2" fill={kind.color} />
      <text x="3.5" y="24.8" fill="#fff" fontSize="7" fontWeight="700" fontFamily="system-ui, sans-serif">
        {kind.label}
      </text>
    </svg>
  );
}

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${String(bytes)} B`
    : `${(bytes / 1024).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} kB`;
