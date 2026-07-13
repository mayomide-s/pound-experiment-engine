import { Link } from "react-router-dom";

import { PublicContactDetails } from "../components/PublicContactDetails";
import { PublicPageLayout } from "../components/PublicPageLayout";

export function ContactPage() {
  return (
    <PublicPageLayout
      title="Contact"
      intro={
        <p className="public-lead">
          Use this page for refund requests, payment issues, privacy questions, or general feedback about the experiment.
        </p>
      }
    >
      <section className="public-section-grid">
        <article className="public-card">
          <h2>Support contact</h2>
          <p>
            <PublicContactDetails className="inline-link" />
          </p>
          <p>Include enough context for the operator to identify the issue quickly without sending sensitive payment credentials.</p>
        </article>
        <article className="public-card">
          <h2>What to include</h2>
          <ul className="public-list">
            <li>Refund requests: approximate payment time, amount, and what went wrong.</li>
            <li>Payment issues: what you saw on-screen and whether Stripe Checkout completed.</li>
            <li>Privacy questions: what information you want to access, correct, or delete.</li>
            <li>General feedback: what you found useful, confusing, or worth improving.</li>
          </ul>
        </article>
      </section>

      <section className="public-section-grid">
        <article className="public-card">
          <h2>What not to send</h2>
          <p>Do not send card numbers, CVC codes, expiry dates, passwords, or full payment credentials.</p>
        </article>
        <article className="public-card">
          <h2>Helpful links</h2>
          <div className="public-link-list">
            <Link className="inline-link" to="/privacy">Privacy Policy</Link>
            <Link className="inline-link" to="/terms">Terms</Link>
            <Link className="inline-link" to="/refunds">Refund Policy</Link>
          </div>
        </article>
      </section>
    </PublicPageLayout>
  );
}
