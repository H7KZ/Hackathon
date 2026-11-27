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
};
