import { ChatRoute } from "../../components/chat/ChatRoute";
import { isLayout } from "../../lib/chat/layout";

type Params = Record<string, string | string[] | undefined>;

/**
 * `/chat?demo=1` lists the recorded demo cases, `/chat?demo=<case>[&s=<id>]` replays one (docs/demo-data.md);
 * `/chat?s=<sessionId>` reconnects to the API. `&layout=` picks a layout.
 */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  return (
    <ChatRoute
      demo={sp.demo !== undefined}
      demoCase={typeof sp.demo === "string" && sp.demo !== "1" && sp.demo !== "" ? sp.demo : null}
      sessionId={typeof sp.s === "string" ? sp.s : null}
      layout={isLayout(sp.layout) ? sp.layout : "thread"}
    />
  );
}
