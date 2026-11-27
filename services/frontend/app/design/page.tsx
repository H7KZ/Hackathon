import type { Metadata } from "next";
import { DesignGallery } from "../../components/DesignGallery";
import "./design.css";

export const metadata: Metadata = { title: "JOJO · design systém" };

export default function DesignPage() {
  return <DesignGallery />;
}
