import { PublicContactDetails } from "../components/PublicContactDetails";
import { PublicPageLayout } from "../components/PublicPageLayout";

export function RefundsPage() {
  return (
    <PublicPageLayout
      title="Refund Policy"
      intro={
        <p className="public-lead">
          Payments are generally voluntary and final, but refund requests can still be reviewed in a small number of fair, practical cases.
        </p>
      }
    >
      <section className="public-section-grid">
        <article className="public-card">
          <h2>General position</h2>
          <p>Once a payment is completed, it is generally treated as voluntary and final.</p>
          <p>Refund requests may still be reviewed for duplicate payment, technical error, or payment made unintentionally.</p>
        </article>
        <article className="public-card">
          <h2>What to include</h2>
          <p>Include enough information to help locate the transaction, such as the checkout time, amount, email used during checkout if known, and a short description of the issue.</p>
          <p>Do not send card numbers, CVC codes, expiry dates, passwords, or full payment credentials.</p>
        </article>
      </section>

      <section className="public-section-grid">
        <article className="public-card">
          <h2>How refunds are returned</h2>
          <p>If a refund is approved, it is returned through the original payment method used in Stripe Checkout.</p>
          <p>Processing time can depend on Stripe and the card issuer.</p>
        </article>
        <article className="public-card">
          <h2>Where to send requests</h2>
          <p>
            Refund contact: <PublicContactDetails className="inline-link" />
          </p>
        </article>
      </section>
    </PublicPageLayout>
  );
}
