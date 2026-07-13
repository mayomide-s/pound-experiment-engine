import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PublicFooter } from "../components/PublicFooter";
import { api, PublicCheckoutStatusResponse } from "../api/client";
import { normalizePublicSourceCode, triggerPublicExperimentStatsRefresh } from "./PublicExperiment";

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1200;
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]+$/;
const SHARE_COPY = "Would you give a stranger £1? I just took part in this transparent internet experiment.";

function safeExperimentUrl() {
  return `${window.location.origin}/experiment`;
}

export function ExperimentThankYouPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<PublicCheckoutStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);

  const sessionId = searchParams.get("session_id") ?? "";
  const normalizedSourceCode = normalizePublicSourceCode(searchParams.get("source"));
  const validSessionId = useMemo(() => (SESSION_ID_PATTERN.test(sessionId) ? sessionId : ""), [sessionId]);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const experimentPath = normalizedSourceCode === "direct" ? "/experiment" : `/experiment?source=${encodeURIComponent(normalizedSourceCode)}`;

  useEffect(() => {
    document.title = "Thank you | The £1 Experiment";
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function loadStatus() {
      if (!validSessionId) {
        setError("The return session looked invalid.");
        setIsLoading(false);
        return;
      }
      try {
        const payload = await api.getPublicCheckoutStatus(validSessionId);
        setStatus(payload);
        setError("");
        if (payload.status === "completed") {
          triggerPublicExperimentStatsRefresh();
        }
        const needsRetry =
          payload.status !== "completed" &&
          payload.payment_status !== "unpaid" &&
          retryCountRef.current < MAX_ATTEMPTS - 1;
        if (needsRetry) {
          retryCountRef.current += 1;
          timeoutRef.current = window.setTimeout(() => {
            void loadStatus();
          }, RETRY_DELAY_MS);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to verify the session yet.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadStatus();
  }, [validSessionId]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(safeExperimentUrl());
      setCopyMessage("Experiment link copied.");
    } catch {
      setCopyMessage("Copy failed. You can still copy the link from the address bar.");
    }
  }

  async function handleShare() {
    if (!canNativeShare) {
      return;
    }
    try {
      await navigator.share({
        title: "Would you give a stranger £1?",
        text: SHARE_COPY,
        url: safeExperimentUrl(),
      });
    } catch {
      // User cancellation is safe to ignore.
    }
  }

  const shareUrl = encodeURIComponent(safeExperimentUrl());
  const shareText = encodeURIComponent(SHARE_COPY);
  const isFailureStatus = status?.status === "expired" || status?.status === "failed";

  return (
    <main className="public-shell">
      <div className="public-page public-thank-you-page">
        <section className="public-card public-status-card" aria-live="polite">
          <p className="public-kicker">Checkout return</p>
          {isLoading ? <h1>Verifying your participation...</h1> : null}
          {!isLoading && !error && status?.status === "completed" ? (
            <>
              <h1>Thank you - you're part of the experiment.</h1>
              <p>Your £1 participation was received successfully.</p>
            </>
          ) : null}
          {!isLoading && !error && isFailureStatus ? (
            <>
              <h1>This checkout didn't complete.</h1>
              <p>No confirmed payment was recorded for this session.</p>
            </>
          ) : null}
          {!isLoading && !error && status?.status !== "completed" && !isFailureStatus ? (
            <>
              <h1>We're still verifying the payment.</h1>
              <p>The browser return succeeded, but the webhook confirmation may still be arriving. This page retries a few times automatically.</p>
            </>
          ) : null}
          {!isLoading && error ? (
            <>
              <h1>We couldn't confirm this session yet.</h1>
              <p>{error}</p>
            </>
          ) : null}

          {status ? (
            <div className="key-grid public-status-grid">
              <div><span>Status</span><strong>{status.status}</strong></div>
              <div><span>Payment</span><strong>{status.payment_status ?? "pending"}</strong></div>
              <div><span>Amount</span><strong>{status.currency} {(status.amount_total_minor / 100).toFixed(2)}</strong></div>
              <div><span>Campaign</span><strong>{status.campaign_name}</strong></div>
            </div>
          ) : null}

          <div className="button-row public-share-row">
            <button type="button" onClick={handleCopyLink}>Copy experiment link</button>
            {canNativeShare ? <button type="button" className="secondary" onClick={handleShare}>Share</button> : null}
            <a className="button-link secondary-link" href={`https://wa.me/?text=${shareText}%20${shareUrl}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
            <a className="button-link secondary-link" href={`https://x.com/intent/post?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noreferrer">Share on X</a>
          </div>
          {copyMessage ? <p className="subtle" role="status">{copyMessage}</p> : null}
          <Link className="inline-link" to={experimentPath}>Back to the experiment page</Link>
        </section>
        <PublicFooter />
      </div>
    </main>
  );
}
