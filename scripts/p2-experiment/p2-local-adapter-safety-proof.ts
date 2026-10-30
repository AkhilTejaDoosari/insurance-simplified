// Offline replay of the exact saved compact response. Makes no provider calls.
import { readFile } from "node:fs/promises";
import { verifyEvidenceCitation } from "@/app/lib/evidence-verification";
import { attestPlans } from "@/app/lib/extraction/plan-identity";
import {
  adaptCompactValue,
  recognizeExperimentalPlanTitle,
} from "./compact-adapter";

const savedPath =
  "nonstandard/p2-compact-spike/live-proof-2026-10-28/provider-response.raw.json";
const sourcePath = "nonstandard/fep-sonnet-replay-run/source-pages.json";
async function main() {
  const envelope = JSON.parse(await readFile(savedPath, "utf8"));
  if (envelope.choices?.[0]?.finish_reason !== "stop")
    throw new Error("saved compact response is not complete");
  const compact = JSON.parse(envelope.choices[0].message.content);
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const documentId = compact.docs[0].d;
  const pages = Array.from({ length: source.pageCount }, () => "");
  for (const page of source.selectedPages)
    pages[page.pageNumber - 1] = page.text;
  const documents = [
    {
      documentId,
      filename: source.filename,
      pageCount: source.pageCount,
      pages,
    },
  ];
  const candidates = compact.facts.flatMap((fact: any) =>
    fact.values.map((value: any) => ({
      concept: fact.concept,
      value: value.value,
      status: adaptCompactValue(
        {
          documentId: fact.d,
          concept: fact.concept,
          value: value.value,
          scope: value.scope,
          evidence: value.e.map(([page, quote]: [number, string]) => ({
            page,
            quote,
          })),
        },
        documents,
      ),
    })),
  );
  const title = compact.plans[0];
  const citationResults = compact.facts.flatMap((fact: any) =>
    fact.values.flatMap((value: any) =>
      value.e.map(([page, quote]: [number, string]) =>
        verifyEvidenceCitation(documents, { documentId: fact.d, page, quote }),
      ),
    ),
  );
  console.log(
    JSON.stringify(
      {
        candidateCount: candidates.length,
        accepted: candidates.filter(
          (candidate: any) => candidate.status.status === "accepted",
        ).length,
        rejected: candidates.filter(
          (candidate: any) => candidate.status.status !== "accepted",
        ).length,
        citationsVerified: citationResults.filter((result: any) => result.ok)
          .length,
        citationsRejected: citationResults.filter((result: any) => !result.ok)
          .length,
        candidates,
        titleRecognition: recognizeExperimentalPlanTitle(
          title.name,
          documents[0],
        ),
        productionAttestedPlans: attestPlans(documents).length,
      },
      null,
      2,
    ),
  );
}

void main();
