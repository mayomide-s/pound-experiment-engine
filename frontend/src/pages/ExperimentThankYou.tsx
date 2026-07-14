import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { PublicFooter } from "../components/PublicFooter";
import { api, PublicCheckoutStatusResponse } from "../api/client";
import { buildExperimentShareUrl, SHARE_EMAIL_SUBJECT, SHARE_MESSAGE, SHARE_TITLE } from "../public/share";
import { normalizePublicSourceCode, triggerPublicExperimentStatsRefresh } from "./PublicExperiment";

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1200;
const COPY_RESET_DELAY_MS = 1800;
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]+$/;

export function ExperimentThankYouPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<PublicCheckoutStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);

  const sessionId = searchParams.get("session_id") ?? "";
  const normalizedSourceCode = normalizePublicSourceCode(searchParams.get("source"));
  const validSessionId = useMemo(() => (SESSION_ID_PATTERN.test(sessionId) ? sessionId : ""), [sessionId]);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const experimentPath = normalizedSourceCode === "direct" ? "/experiment" : `/experiment?source=${encodeURIComponent(normalizedSourceCode)}`;
  const isCompletedPaid = status?.status === "completed" && status.payment_status === "paid";
  const shareReferralCode = isCompletedPaid ? status.referral_code ?? null : null;
  const shareUrl = shareReferralCode ? buildExperimentShareUrl(shareReferralCode) : "";
  const whatsappShareUrl = shareReferralCode
    ? `https://wa.me/?text=${encodeURIComponent(`${SHARE_MESSAGE} ${shareUrl}`)}`
    : "";
  const twitterShareUrl = shareReferralCode
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_MESSAGE)}&url=${encodeURIComponent(shareUrl)}`
    : "";
  const emailShareUrl = shareReferralCode
    ? `mailto:?subject=${encodeURIComponent(SHARE_EMAIL_SUBJECT)}&body=${encodeURIComponent(`${SHARE_MESSAGE}\n\n${shareUrl}`)}`
    : "";

  useEffect(() => {
    document.title = "Thank you | The £1 Experiment";
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
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
        if (payload.status === "completed" && payload.payment_status === "paid") {
          triggerPublicExperimentStatsRefresh();
        }
        const awaitingReferralCode =
          payload.status === "completed" &&
          payload.payment_status === "paid" &&
          !payload.referral_code;
        const awaitingCompletion =
          payload.status !== "completed" &&
          payload.status !== "expired" &&
          payload.status !== "failed" &&
          payload.payment_status !== "unpaid";
        const needsRetry =
          (awaitingCompletion || awaitingReferralCode) &&
          retryCountRef.current < MAX_ATTEMPTS - 1;
        if (needsRetry) {
          retryCountRef.current += 1;
          if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current);
          }
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
    if (!shareUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage("Link copied");
    } catch {
      setCopyMessage("Copy failed. You can still copy the share link manually.");
    }
    if (copyResetTimeoutRef.current) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => setCopyMessage(""), COPY_RESET_DELAY_MS);
  }

  async function handleShare() {
    if (!canNativeShare || !shareUrl) {
      return;
    }
    try {
      await navigator.share({
        title: SHARE_TITLE,
        text: SHARE_MESSAGE,
        url: shareUrl,
      });
    } catch {
      // User cancellation is safe to ignore.
    }
  }

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
              {isCompletedPaid && !shareUrl ? (
                <p>We&apos;re preparing your personal share link now and will retry automatically for a moment.</p>
              ) : null}
            </>
          ) : null}
          {!isLoading && !error && isFailureStatus ? (
            <>
              <h1>This checkout didn&apos;t complete.</h1>
              <p>No confirmed payment was recorded for this session.</p>
            </>
          ) : null}
          {!isLoading && !error && status?.status !== "completed" && !isFailureStatus ? (
            <>
              <h1>We&apos;re still verifying the payment.</h1>
              <p>The browser return succeeded, but the webhook confirmation may still be arriving. This page retries a few times automatically.</p>
            </>
          ) : null}
          {!isLoading && error ? (
            <>
              <h1>We couldn&apos;t confirm this session yet.</h1>
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

          <Link className="inline-link" to={experimentPath}>Back to the experiment page</Link>
        </section>
        {!isLoading && !error && isCompletedPaid && shareUrl ? (
          <section className="public-card public-share-card" aria-live="polite">
            <p className="public-kicker">Share the experiment</p>
            <h2>{SHARE_TITLE}</h2>
            <p>{SHARE_MESSAGE}</p>
            <div className="button-row public-share-row">
              {canNativeShare ? (
                <button type="button" onClick={handleShare} aria-label="Share your referral link natively">
                  Share
                </button>
              ) : null}
              <button type="button" className="secondary" onClick={handleCopyLink} aria-label="Copy your referral link">
                Copy link
              </button>
              <a
                className="button-link secondary-link"
                href={whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share your referral link on WhatsApp"
              >
                WhatsApp
              </a>
              <a
                className="button-link secondary-link"
                href={twitterShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Share your referral link on X"
              >
                X / Twitter
              </a>
              <a
                className="button-link secondary-link"
                href={emailShareUrl}
                aria-label="Share your referral link by email"
              >
                Email
              </a>
            </div>
            <p className="subtle">Use Copy link if you want to share it in Instagram messages, stories, or your bio.</p>
            <p className="subtle" role="status">{copyMessage || " "}</p>
          </section>
        ) : null}
        <PublicFooter />
      </div>
    </main>
  );
}
