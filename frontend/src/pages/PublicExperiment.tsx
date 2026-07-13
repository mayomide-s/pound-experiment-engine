import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PublicContactDetails } from "../components/PublicContactDetails";
import { PublicFooter } from "../components/PublicFooter";
import { PublicPolicyNav } from "../components/PublicPolicyNav";
import { api, type PublicExperimentStatsResponse } from "../api/client";
import { FAQ_ITEMS, HOW_IT_WORKS_STEPS, MONEY_USE_STATEMENT, TRUST_POINTS } from "../public/content";

const EXPERIMENT_URL = "/experiment";
const DEFAULT_SOURCE_CODE = "direct";
const SOURCE_CODE_PATTERN = /^[a-z0-9_-]{1,64}$/;
const STATS_REFRESH_INTERVAL_MS = 30000;
const STATS_REFRESH_STORAGE_KEY = "public-experiment-stats-refresh";

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

function ensureMetaTag(name: "description" | "og:title" | "og:description", content: string, property = false) {
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    if (property) {
      element.setAttribute("property", name);
    } else {
      element.setAttribute("name", name);
    }
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function ensureCanonical(url: string) {
  let element = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", url);
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function formatUpdatedLabel(updatedAt: string) {
  const updatedDate = new Date(updatedAt);
  if (Number.isNaN(updatedDate.getTime())) {
    return "Updated recently";
  }
  const minutesAgo = Math.max(0, Math.round((Date.now() - updatedDate.getTime()) / 60000));
  if (minutesAgo <= 1) {
    return "Updated just now";
  }
  if (minutesAgo < 60) {
    return `Updated ${minutesAgo} minutes ago`;
  }
  return `Updated ${updatedDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function triggerPublicExperimentStatsRefresh() {
  const stamp = new Date().toISOString();
  window.sessionStorage.setItem(STATS_REFRESH_STORAGE_KEY, stamp);
  window.dispatchEvent(new CustomEvent("public-experiment-stats-refresh"));
}

export function PublicExperimentPage() {
  const [searchParams] = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<PublicExperimentStatsResponse | null>(null);
  const [statsError, setStatsError] = useState("");
  const [isStatsLoading, setIsStatsLoading] = useState(true);

  const checkoutState = searchParams.get("checkout");
  const rawSourceCode = searchParams.get("source_code") ?? searchParams.get("source");
  const normalizedSourceCode = useMemo(() => normalizePublicSourceCode(rawSourceCode), [rawSourceCode]);
  const invalidSharedSource = Boolean(rawSourceCode && normalizedSourceCode === DEFAULT_SOURCE_CODE);
  const displaySourceCode = normalizedSourceCode === DEFAULT_SOURCE_CODE ? "" : normalizedSourceCode;

  useEffect(() => {
    document.title = "Would you give a stranger £1? | The £1 Experiment";
    ensureMetaTag("description", "A transparent internet social experiment asking whether people would voluntarily send £1 to a stranger.");
    ensureMetaTag("og:title", "Would you give a stranger £1?", true);
    ensureMetaTag("og:description", "A transparent internet social experiment measuring voluntary £1 participation.", true);
    ensureCanonical(`${window.location.origin}${EXPERIMENT_URL}`);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      try {
        if (isMounted) {
          setStatsError("");
        }
        const payload = await api.getPublicExperimentStats();
        if (isMounted) {
          setStats(payload);
        }
      } catch {
        if (isMounted) {
          setStatsError("Live totals are temporarily unavailable.");
        }
      } finally {
        if (isMounted) {
          setIsStatsLoading(false);
        }
      }
    }

    void loadStats();
    const intervalId = window.setInterval(() => {
      void loadStats();
    }, STATS_REFRESH_INTERVAL_MS);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STATS_REFRESH_STORAGE_KEY && event.newValue) {
        void loadStats();
      }
    };
    const handleRefresh = () => {
      void loadStats();
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("public-experiment-stats-refresh", handleRefresh);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("public-experiment-stats-refresh", handleRefresh);
    };
  }, []);

  async function handleCheckout() {
    try {
      setIsSubmitting(true);
      setError("");
      const response = await api.createPublicCheckoutSession({ source_code: normalizedSourceCode });
      window.location.assign(response.checkout_url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start secure checkout right now.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="public-shell">
      <div className="public-page">
        <section className="public-hero">
          <div className="public-header-row">
            <span className="subtle">Voluntary public participation page</span>
            <PublicPolicyNav className="public-policy-nav" />
          </div>
          <p className="public-kicker">The £1 Experiment</p>
          <h1>Would you give a stranger £1?</h1>
          <p className="public-lead">
            This is a transparent social experiment measuring how many people voluntarily send £1 to a stranger simply because they were asked.
          </p>
          <div className="public-disclosure-strip" aria-label="Required disclosure">
            <span>£1 participation</span>
            <span>Not a product</span>
            <span>Not a charity donation</span>
            <span>Stripe-hosted checkout</span>
          </div>
          <div className="public-cta-block">
            <button type="button" className="public-primary-button" onClick={handleCheckout} disabled={isSubmitting}>
              {isSubmitting ? "Starting secure checkout..." : "Send £1"}
            </button>
            <p className="subtle" aria-live="polite">Secure payment handled by Stripe.</p>
            {displaySourceCode ? <p className="subtle">Source code detected: <code>{displaySourceCode}</code></p> : null}
            {checkoutState === "cancelled" ? (
              <p className="notice-inline" role="status" aria-live="polite">Payment cancelled - no payment was taken.</p>
            ) : null}
            {invalidSharedSource ? (
              <p className="notice-inline warning" role="status" aria-live="polite">The shared source code looked invalid, so it was ignored safely.</p>
            ) : null}
            {error ? <p className="error" role="alert">{error}</p> : null}
          </div>
        </section>

        <section className="public-section-grid">
          <article className="public-card">
            <p className="public-kicker">Live counter</p>
            <h2>{stats ? `${stats.participant_count} people said yes` : "Live participation counter"}</h2>
            <p className="public-lead">
              {stats ? `${formatMoney(stats.amount_collected_minor, stats.currency)} collected so far.` : "Confirmed paid checkouts appear here automatically."}
            </p>
            <p className="subtle">
              {stats ? formatUpdatedLabel(stats.updated_at) : isStatsLoading ? "Loading live totals..." : "Updated recently"}
            </p>
            {statsError ? <p className="notice-inline warning">{statsError}</p> : null}
          </article>
          <article className="public-card">
            <h2>What happens to the money</h2>
            <p>{MONEY_USE_STATEMENT}</p>
          </article>
        </section>

        <section className="public-section-grid" aria-labelledby="trust-heading">
          <article className="public-card public-card-wide">
            <h2 id="trust-heading">Trust and payment details</h2>
            <ul className="public-list">
              {TRUST_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p>
              Contact: <PublicContactDetails className="inline-link" />
            </p>
          </article>
        </section>

        <section className="public-section-grid" aria-labelledby="how-it-works-heading">
          <article className="public-card public-card-wide">
            <h2 id="how-it-works-heading">How it works</h2>
            <ol className="public-steps">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        </section>

        <section className="public-section-grid">
          <article className="public-card">
            <h2>What happens after payment</h2>
            <p>Your £1 is recorded as voluntary participation in the experiment. It does not buy a product, enter a prize draw, or count as a charitable donation.</p>
            <p>
              If the browser returns before the total refreshes, the thank-you page retries while Stripe webhook confirmation catches up.
            </p>
          </article>
          <article className="public-card">
            <h2>Privacy and public display</h2>
            <p>Public pages show aggregate totals only. Participant names, email addresses, payment details, Stripe identifiers, and backend IDs are not shown publicly.</p>
            <div className="public-link-list">
              <Link className="inline-link" to="/privacy">Read the Privacy Policy</Link>
              <Link className="inline-link" to="/refunds">Read the Refund Policy</Link>
            </div>
          </article>
        </section>

        <section className="public-section-grid" aria-labelledby="faq-heading">
          <article className="public-card public-card-wide">
            <h2 id="faq-heading">Frequently asked questions</h2>
            <div className="public-faq-list">
              {FAQ_ITEMS.map((item) => (
                <details key={item.question} className="public-faq-item">
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </article>
        </section>

        <section className="public-card public-final-cta">
          <h2>Take part if you want to</h2>
          <p>The experiment only works if participation stays informed, transparent, and voluntary.</p>
          <button type="button" className="public-primary-button" onClick={handleCheckout} disabled={isSubmitting}>
            {isSubmitting ? "Starting secure checkout..." : "Send £1"}
          </button>
        </section>

        <PublicFooter />
      </div>
    </main>
  );
}
