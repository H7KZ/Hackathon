import type { Metadata } from "next";
import { Titillium_Web } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "../components/Footer";
import { Providers } from "./providers";
import "./globals.css";

const titillium = Titillium_Web({ weight: ["400", "600"], subsets: ["latin", "latin-ext"] });

export const metadata: Metadata = {
  title: "JOJO",
  description: "Generátor propojených datasetů s příběhem zapsaným v datech",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body className={`${titillium.className} flex min-h-screen flex-col bg-dots text-fis-dark antialiased`}>
        <Providers>
          <main className="flex flex-1 flex-col px-4">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
