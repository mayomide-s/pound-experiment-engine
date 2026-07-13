import { PublicContactDetails } from "../components/PublicContactDetails";
import { PublicPageLayout } from "../components/PublicPageLayout";

export function PrivacyPage() {
  return (
    <PublicPageLayout
      title="Privacy Policy"
      intro={
        <p className="public-lead">
          This page explains what information the experiment stores, why it is used, and how to get in touch with privacy questions.
        </p>
      }
    >
      <section className="public-section-grid">
        <article className="public-card">
          <h2>What information is collected</h2>
          <p>The site stores checkout-session records needed to operate the experiment, confirm payments, and show public totals.</p>
          <ul className="public-list">
            <li>Checkout and session identifiers created by the backend or returned by Stripe.</li>
            <li>Payment status, checkout status, currency, amount, and completion timestamps.</li>
            <li>Source attribution such as <code>tiktok</code>, <code>instagram</code>, or <code>direct</code>.</li>
            <li>Basic technical logs and request information used to keep the service running.</li>
          </ul>
        </article>
        <article className="public-card">
          <h2>Payment processing</h2>
          <p>Stripe processes checkout payments. Full card details are handled by Stripe and are not stored by this application.</p>
          <p>The application may store limited payment-related references needed to reconcile checkouts, prevent duplicate processing, and review refund requests.</p>
        </article>
      </section>

      <section className="public-section-grid">
        <article className="public-card">
          <h2>Why the information is used</h2>
          <ul className="public-list">
            <li>To create and confirm Stripe Checkout sessions.</li>
            <li>To update the public participation counter accurately.</li>
            <li>To review payment issues, duplicate charges, and refund requests.</li>
            <li>To protect the service from misuse, errors, and abuse.</li>
          </ul>
        </article>
        <article className="public-card">
          <h2>Retention and sharing</h2>
          <p>Records may be retained for as long as reasonably needed to operate the experiment, handle disputes, keep accounting records, and maintain service security.</p>
          <p>Information may be shared with service providers that help run the site, such as Stripe, hosting providers, and infrastructure or logging services.</p>
        </article>
      </section>

      <section className="public-section-grid">
        <article className="public-card">
          <h2>Analytics and advertising tools</h2>
          <p>The current setup uses internal source tracking instead of third-party advertising pixels. This task does not add Google Analytics, Meta Pixel, or cookie-based ad tracking.</p>
        </article>
        <article className="public-card">
          <h2>Your requests and questions</h2>
          <p>You can ask for access, correction, or deletion of information where applicable by contacting the operator.</p>
          <p>
            Privacy contact: <PublicContactDetails className="inline-link" />
          </p>
        </article>
      </section>
    </PublicPageLayout>
  );
}
