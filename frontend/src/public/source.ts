const EXPERIMENT_PATH = "/experiment";
const DEFAULT_SOURCE_CODE = "direct";
const SOURCE_CODE_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function normalizePublicSourceCode(rawSourceCode: string | null) {
  if (rawSourceCode === null) {
    return DEFAULT_SOURCE_CODE;
  }
  const normalized = rawSourceCode.trim().toLowerCase();
  if (!normalized || !SOURCE_CODE_PATTERN.test(normalized)) {
    return DEFAULT_SOURCE_CODE;
  }
  return normalized;
}

export function validateSourceCode(rawSourceCode: string | null): string | null {
  if (rawSourceCode === null) {
    return null;
  }
  const normalized = rawSourceCode.trim().toLowerCase();
  if (!normalized || !SOURCE_CODE_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function buildExperimentSourceUrl(sourceCode: string | null, origin = window.location.origin): string {
  const url = new URL(EXPERIMENT_PATH, origin);
  const validatedSourceCode = validateSourceCode(sourceCode);
  if (validatedSourceCode && validatedSourceCode !== DEFAULT_SOURCE_CODE) {
    url.searchParams.set("source", validatedSourceCode);
  }
  return url.toString();
}
