// Only throw this before any shipment-creating call, or for a documented validation
// rejection followed by a successful lookup proving there is no tendered PO.
export class NoShipmentSubmissionError extends Error {
  readonly evidence: "preflight_failed" | "validation_rejected";
  constructor(message: string, evidence: "preflight_failed" | "validation_rejected" = "preflight_failed") {
    super(message); this.name = "NoShipmentSubmissionError"; this.evidence = evidence;
  }
}
export function isNoShipmentSubmissionError(error: unknown): error is NoShipmentSubmissionError {
  return error instanceof NoShipmentSubmissionError;
}
export async function beforeShipmentSubmission<T>(operation: () => Promise<T>, message: string): Promise<T> {
  try { return await operation(); }
  catch { throw new NoShipmentSubmissionError(message); }
}
export function isTqlValidationRejection(status: number, value: unknown) {
  if (status !== 400 || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const content = data.content && typeof data.content === "object" ? data.content as Record<string, unknown> : null;
  if (content?.poNumber || data.poNumber || data.bolNumber || (data.statusCode !== 400 && data.status !== 400)) return false;
  const errors = content?.errors ?? data.errors;
  if (Array.isArray(errors)) return errors.length > 0 && errors.every(item => typeof item === "string" && item.trim().length > 0);
  return Boolean(errors && typeof errors === "object" && Object.keys(errors).length > 0 && Object.values(errors).every(item => Array.isArray(item) && item.length && item.every(text => typeof text === "string" && text.trim().length > 0)));
}
