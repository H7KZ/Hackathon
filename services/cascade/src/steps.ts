/** Agent steps A1–A4: each is `(llm, inputs) -> zod-validated artifact`. A5 lives in a5_detail.ts. */
import type { Llm } from "@s2d/llm";
import {
  CompanySpec,
  DataModel,
  Influences,
  StoryPlan,
  type CompanySpec as CompanySpecT,
  type DataModel as DataModelT,
  type Influences as InfluencesT,
  type StoryPlan as StoryPlanT,
} from "@s2d/schema/artifacts";
import { A1_COMPANY, A2_MODEL, A3_INFLUENCES, A4_STORY, userPrompt } from "./prompts/index";

export interface CascadeInput {
  story: string;
  company: string;
}

export function a1Company(llm: Llm, input: CascadeInput): Promise<CompanySpecT> {
  return llm.object({
    schemaName: "01_company",
    schema: CompanySpec,
    instructions: A1_COMPANY,
    prompt: userPrompt({ Company: input.company, Story: input.story }),
  });
}

export function a2Model(llm: Llm, company: CompanySpecT): Promise<DataModelT> {
  return llm.object({
    schemaName: "02_model",
    schema: DataModel,
    instructions: A2_MODEL,
    prompt: userPrompt({ "01_company": company }),
  });
}

export function a3Influences(llm: Llm, company: CompanySpecT, model: DataModelT): Promise<InfluencesT> {
  return llm.object({
    schemaName: "03_influences",
    schema: Influences,
    instructions: A3_INFLUENCES,
    prompt: userPrompt({ "01_company": company, "02_model": model }),
  });
}

export function a4Story(
  llm: Llm,
  input: CascadeInput,
  model: DataModelT,
  influences: InfluencesT,
): Promise<StoryPlanT> {
  return llm.object({
    schemaName: "04_story",
    schema: StoryPlan,
    instructions: A4_STORY,
    prompt: userPrompt({ Story: input.story, "02_model": model, "03_influences": influences }),
  });
}
