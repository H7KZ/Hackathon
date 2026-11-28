/** What the landing prompt accepts. Pure, so it is testable without a browser. */
import type { SessionInput } from "@s2d/schema/api";

// the API has no upload route: only text files can be sent, appended to the story
const TEXT_FILE = /\.(txt|md|csv|json)$/i;
export const MAX_FILE_BYTES = 200_000;
export const ACCEPTED_FILES = ".txt,.md,.csv,.json";

export const isAccepted = (file: File) => TEXT_FILE.test(file.name) && file.size <= MAX_FILE_BYTES;

export type PromptError = { message: string; field: keyof SessionInput; invalid: boolean };

export function findMissing(company: string, story: string, fileCount: number): PromptError | null {
  if (!company.trim()) return { field: "company", message: "Doplňte, o jakou firmu jde.", invalid: true };
  if (!story.trim() && fileCount === 0) {
    return { field: "story", message: "Popište příběh, nebo přiložte soubor.", invalid: true };
  }
  return null;
}

export async function toSessionInput(company: string, story: string, files: File[]): Promise<SessionInput> {
  const attached = await Promise.all(files.map(async (f) => `\n\n[${f.name}]\n${await f.text()}`));
  return { company: company.trim(), story: (story.trim() + attached.join("")).trim() };
}

export const EXAMPLES = [
  {
    label: "Dodavatel",
    company: "E-shop s domácími spotřebiči",
    story: "Dodavatel začal v březnu zpožďovat dodávky. Zákazníci si stěžují a část z nich ruší objednávky.",
  },
  {
    label: "Marketing",
    company: "Online obchod se sportovním vybavením",
    story: "Po jarní kampani přišlo hodně nových zákazníků, ale většina už podruhé nenakoupila.",
  },
  {
    label: "Podpora",
    company: "Poskytovatel internetového připojení",
    story: "Po aktualizaci routerů prudce přibylo hovorů na podporu a narostla doba čekání.",
  },
] as const;
