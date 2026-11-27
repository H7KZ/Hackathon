import { ChatRoute } from "../../components/chat/ChatRoute";

type Params = Record<string, string | string[] | undefined>;

/** `/chat?demo=1[&s=<id>]` replays the mock workflow; `/chat?s=<sessionId>` reconnects to the API. */
export default async function ChatPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  return <ChatRoute demo={sp.demo !== undefined} sessionId={typeof sp.s === "string" ? sp.s : null} />;
}
