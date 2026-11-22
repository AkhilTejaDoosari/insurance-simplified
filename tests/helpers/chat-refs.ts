// Test helper for citation-by-reference (owner decision 2026-11-22): a fake
// model answer that cites, by passage id and line range, the prompt lines
// that contain the given text — the reference equivalent of the typed quote
// these tests used before. Synthetic text only.
type Messages = Array<{ role: string; content: string }>;

/** Passage id and line range of `text` in the prompt actually sent. */
export function refFor(prompt: string, text: string): { passageId: string; fromLine: number; toLine: number } {
  const want = text.split("\n").map((l) => l.trim());
  for (const block of prompt.split(/(?=\[Page \d+\] passage P\d+\n)/)) {
    const head = /^\[Page \d+\] passage (P\d+)\n/.exec(block);
    if (!head) continue;
    const lines = block.slice(head[0].length).split("\n").map((l) => /^\d+\| (.*)$/.exec(l)?.[1]);
    for (let i = 0; i < lines.length; i++) {
      if (want.every((w, j) => lines[i + j]?.trim() === w)) return { passageId: head[1], fromLine: i + 1, toLine: i + want.length };
    }
  }
  throw new Error(`refFor: text not found in any prompt passage: ${text.slice(0, 60)}`);
}

/** completeJson mock implementation: an answer citing the lines of each quote. */
export function answerCiting(answerText: string, ...quotes: string[]) {
  return async (messages: Messages) => ({
    cantAnswer: false,
    answerText,
    citations: quotes.map((q) => refFor(messages[0].content, q)),
  });
}
