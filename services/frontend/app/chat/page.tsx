import { ChatRoute } from "../../components/chat/ChatRoute";
import { isLayout } from "../../lib/chat/layout";

type Params = Record<string, string | string[] | undefined>;

/** `/chat?demo=1[&s=<id>]` replays the mock workflow; `/chat?s=<sessionId>` reconnects to the API. `&layout=` picks a layout. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  return (
    <ChatRoute
      demo={sp.demo !== undefined}
      sessionId={typeof sp.s === "string" ? sp.s : null}
      layout={isLayout(sp.layout) ? sp.layout : "thread"}
    />
  );
}
