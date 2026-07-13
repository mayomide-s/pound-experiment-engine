export const PUBLIC_LAST_UPDATED = "13 July 2026";

export const MONEY_USE_STATEMENT =
  "Money collected through the experiment is retained by the operator and may be used to cover payment processing, hosting, development, administration, and future experiment costs. It is not collected on behalf of a charity.";

export const CONTACT_EMAIL_FALLBACK = "Contact details temporarily unavailable";
const PUBLIC_CONTACT_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function getPublicContactEmail() {
  const rawValue = import.meta.env.VITE_PUBLIC_CONTACT_EMAIL;
  if (typeof rawValue !== "string") {
    return "";
  }
  const normalized = rawValue.trim();
  if (!normalized) {
    return "";
  }
  return PUBLIC_CONTACT_EMAIL_PATTERN.test(normalized) ? normalized : "";
}

export const TRUST_POINTS = [
  "This is a voluntary social experiment. You are choosing whether to take part.",
  "You are not buying a physical product, digital product, subscription, or membership.",
  "The £1 payment is not a charitable donation and is not collected on behalf of a charity.",
  "Participation costs £1 and payment processing is handled by Stripe on Stripe-hosted checkout pages.",
  "This site does not store full card numbers, CVC codes, or complete payment credentials. Stripe handles those details.",
  MONEY_USE_STATEMENT,
  "Payments are generally treated as final, but refund requests may be reviewed for duplicate charges, technical errors, or unintended payments.",
  "Participant names, email addresses, card details, and Stripe payment identifiers are not displayed publicly. Public totals only show aggregate participation.",
];

export const HOW_IT_WORKS_STEPS = [
  "Click the participation button.",
  "Complete the £1 payment through Stripe.",
  "Return to the site and see the experiment total update.",
];

export const FAQ_ITEMS = [
  {
    question: "What is this?",
    answer:
      "It is a public social experiment asking whether someone will voluntarily send £1 simply because they were asked.",
  },
  {
    question: "What do I receive?",
    answer:
      "You receive participation in the experiment only. No product, service, prize entry, investment return, or membership is supplied.",
  },
  {
    question: "Is this a charity donation?",
    answer:
      "No. The payment is not a charitable donation and is not collected on behalf of a charity.",
  },
  {
    question: "Where does the money go?",
    answer: MONEY_USE_STATEMENT,
  },
  {
    question: "Is the payment refundable?",
    answer:
      "Payments are generally voluntary and final once completed, but refund requests may be reviewed for duplicate payments, technical errors, or unintended payments.",
  },
  {
    question: "Is my card information stored?",
    answer:
      "Full card information is handled by Stripe. This application does not store full card numbers, expiry dates, or CVC codes.",
  },
  {
    question: "Will my name or email be shown publicly?",
    answer:
      "No. Public pages show totals and participation counts, not participant names, email addresses, or payment details.",
  },
  {
    question: "Why should I trust this?",
    answer:
      "The site explains the payment purpose clearly, uses Stripe for checkout, shows live totals publicly, and keeps the payment purpose separate from products or charitable claims.",
  },
  {
    question: "How can I contact you?",
    answer:
      "Use the Contact page for refund requests, payment issues, privacy questions, or general feedback.",
  },
  {
    question: "What happens if the payment succeeds but the page does not update immediately?",
    answer:
      "The browser can return before the Stripe webhook finishes updating the record. The thank-you page retries automatically, and the public total updates once the completed payment is confirmed.",
  },
];
