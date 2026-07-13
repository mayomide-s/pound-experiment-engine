import { PublicContactDetails } from "../components/PublicContactDetails";
import { PublicPageLayout } from "../components/PublicPageLayout";
import { MONEY_USE_STATEMENT } from "../public/content";

export function TermsPage() {
  return (
    <PublicPageLayout
      title="Terms"
      intro={
        <p className="public-lead">
          These terms explain what participation means, what the £1 payment covers, and the basic rules for using the site.
        </p>
      }
    >
      <section className="public-section-grid">
        <article className="public-card">
          <h2>Participation basics</h2>
          <ul className="public-list">
            <li>Participation is voluntary.</li>
            <li>The £1 payment is for participation in the social experiment.</li>
            <li>No physical product or digital product is supplied.</li>
            <li>The payment is not a charitable donation.</li>
          </ul>
        </article>
        <article className="public-card">
          <h2>Payments and totals</h2>
          <p>Stripe handles payment processing. Public totals may be delayed briefly while checkout and webhook confirmation finish processing.</p>
          <p>{MONEY_USE_STATEMENT}</p>
        </article>
      </section>

      <section className="public-section-grid">
        <article className="public-card">
          <h2>Acceptable use</h2>
          <p>Do not misuse the service, disrupt it, scrape it aggressively, automate abuse against it, or interfere with checkout, analytics, or public totals.</p>
        </article>
        <article className="public-card">
          <h2>Service changes</h2>
          <p>The operator may modify, suspend, correct, or end the experiment or site features at any time. Totals may be corrected if an error, duplication, or reconciliation issue is discovered.</p>
        </article>
      </section>

      <section className="public-section-grid">
        <article className="public-card">
          <h2>Refunds and limits</h2>
          <p>Refunds are governed by the Refund Policy. If a duplicate payment, technical error, or unintended payment is reported, the request may be reviewed.</p>
          <p>The site is provided in a straightforward, experimental form. Liability is limited to a reasonable extent, and nothing here removes rights that cannot legally be limited.</p>
        </article>
        <article className="public-card">
          <h2>Questions</h2>
          <p>
            Contact: <PublicContactDetails className="inline-link" />
          </p>
        </article>
      </section>
    </PublicPageLayout>
  );
}
