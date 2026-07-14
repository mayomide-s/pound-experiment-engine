const REFERRAL_CODE_PATTERN = /^r_[a-z0-9_-]{1,30}$/;
export const SHARE_TITLE = "You said yes. Now ask someone else.";
export const SHARE_MESSAGE = "I gave £1 to a simple internet experiment. Would you?";
export const SHARE_EMAIL_SUBJECT = "Would you try this £1 experiment?";

export function normalizePublicReferralCode(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || !REFERRAL_CODE_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function buildExperimentShareUrl(referralCode: string, origin = window.location.origin): string {
  const safeReferralCode = normalizePublicReferralCode(referralCode);
  const url = new URL("/experiment", origin);
  if (safeReferralCode) {
    url.searchParams.set("ref", safeReferralCode);
  }
  return url.toString();
}
