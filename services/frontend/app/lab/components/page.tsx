import type { Metadata } from "next";
import { ComponentPlayground } from "../../../components/ComponentPlayground";

export const metadata: Metadata = { title: "JOJO · A2UI komponenty" };

export default function ComponentsPage() {
  return <ComponentPlayground />;
}
