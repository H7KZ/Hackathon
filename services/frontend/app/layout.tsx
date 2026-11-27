import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ApiStatus } from "../components/ApiStatus";
import { Nav } from "../components/Nav";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Story2Data",
  description: "Generátor propojených datasetů s příběhem zapsaným v datech",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body className="min-h-screen bg-white text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <Providers>
          <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10">
            <Nav />
            <ApiStatus />
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
