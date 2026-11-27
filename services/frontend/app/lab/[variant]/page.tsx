import { notFound } from "next/navigation";
import { ChatRoute } from "../../../components/chat/ChatRoute";
import { LAYOUTS, type Layout } from "../../../lib/chat/layout";

/** `/lab/thread | /lab/inspector | /lab/split`: the demo workflow in each layout, with a switcher. */
export default async function LabVariant({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!LAYOUTS.includes(variant as Layout)) notFound();
  return <ChatRoute demo sessionId={null} layout={variant as Layout} switcher />;
}

export function generateStaticParams() {
  return LAYOUTS.map((variant) => ({ variant }));
}
