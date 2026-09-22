// User-facing extraction failure mapping. Technical provider/outage detail
// never reaches the UI: any extraction-phase failure becomes one friendly
// message with an explicit retryable flag for the Try again action.

export const EXTRACT_RETRY_MESSAGE =
  "We couldn't finish reading your documents. Your files and details are still here. Try again.";

export interface ExtractFailure {
  message: string;
  retryable: boolean;
}

interface ExtractErrorBody {
  error?: {
    code?: string;
    retryable?: boolean;
  };
}

/** Map a failed /api/extract result (or network throw) to UI-safe failure. */
export function describeExtractFailure(
  body: unknown,
  thrown: unknown = null
): ExtractFailure {
  if (thrown !== null && thrown !== undefined) {
    return { message: EXTRACT_RETRY_MESSAGE, retryable: true };
  }
  const code =
    typeof body === "object" && body !== null
      ? (body as ExtractErrorBody).error?.code
      : undefined;
  const retryable =
    typeof body === "object" && body !== null
      ? (body as ExtractErrorBody).error?.retryable === true
      : false;
  if (
    code === "PROVIDER_UNAVAILABLE" ||
    code === "EXTRACTION_FAILED" ||
    code === "INTERNAL_ERROR" ||
    code === "DEPENDENCY_UNAVAILABLE"
  ) {
    return {
      message: EXTRACT_RETRY_MESSAGE,
      retryable: code === "EXTRACTION_FAILED" ? true : retryable,
    };
  }
  return { message: EXTRACT_RETRY_MESSAGE, retryable };
}
