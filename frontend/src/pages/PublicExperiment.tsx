import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api, type PublicExperimentStatsResponse } from "../api/client";

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
          <p className="public-kicker">The £1 Experiment</p>
          <h1>Would you give a stranger £1?</h1>
          <p className="public-lead">
            This is a transparent internet social experiment measuring how many people voluntarily send £1 to a stranger simply because they were asked.
          </p>
          <div className="public-disclosure-strip" aria-label="Required disclosure">
            <span>No product</span>
            <span>No charity</span>
            <span>No prize</span>
            <span>No financial return</span>
            <span>Participation is entirely voluntary</span>
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
            <h2>Why the counter matters</h2>
            <p>Only completed, paid checkouts count. Open, expired, or failed sessions stay out of the public total so the number reflects confirmed participation.</p>
          </article>
        </section>

        <section className="public-section-grid">
          <article className="public-card">
            <h2>How it works</h2>
            <ol className="public-steps">
              <li>You choose whether to take part.</li>
              <li>Stripe handles a fixed £1 payment through hosted Checkout.</li>
              <li>You return to a thank-you page once payment is complete.</li>
            </ol>
          </article>
          <article className="public-card">
            <h2>What happens after payment</h2>
            <p>Your £1 is recorded as voluntary participation in the experiment. It does not buy a product, enter a prize draw, or count as a charitable donation.</p>
          </article>
        </section>

        <section className="public-section-grid">
          <article className="public-card">
            <h2>Transparency first</h2>
            <p>No fake statistics, no fabricated donor claims, no hidden upsell, and no claim that this payment will produce any financial return for you.</p>
          </article>
          <article className="public-card">
            <h2>Privacy and payment security</h2>
            <p>Payments are handled on Stripe-hosted pages. This site does not store card numbers, billing addresses, or payment-method details.</p>
          </article>
        </section>

        <section className="public-card public-final-cta">
          <h2>Take part if you want to</h2>
          <p>The experiment only works if participation stays informed, transparent, and voluntary.</p>
          <button type="button" className="public-primary-button" onClick={handleCheckout} disabled={isSubmitting}>
            {isSubmitting ? "Starting secure checkout..." : "Send £1"}
          </button>
        </section>

        <footer className="public-footer">
          <span>Transparent internet social experiment.</span>
          <Link to="/">Private Story Engine dashboard</Link>
        </footer>
      </div>
    </main>
  );
}
