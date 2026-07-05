// Human-readable message from an unknown thrown value (fetch errors, etc.).
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
