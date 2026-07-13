import { PropsWithChildren, ReactNode, useEffect } from "react";
import { Link } from "react-router-dom";

import { PUBLIC_LAST_UPDATED } from "../public/content";
import { PublicFooter } from "./PublicFooter";
import { PublicPolicyNav } from "./PublicPolicyNav";

type PublicPageLayoutProps = PropsWithChildren<{
  title: string;
  eyebrow?: string;
  intro?: ReactNode;
  titleSuffix?: string;
}>;

export function PublicPageLayout({
  title,
  eyebrow = "The £1 Experiment",
  intro,
  titleSuffix = "The £1 Experiment",
  children,
}: PublicPageLayoutProps) {
  useEffect(() => {
    document.title = `${title} | ${titleSuffix}`;
  }, [title, titleSuffix]);

  return (
    <main className="public-shell">
      <div className="public-page">
        <section className="public-card public-info-header">
          <div className="public-header-row">
            <Link className="inline-link" to="/experiment">
              Back to the experiment
            </Link>
            <span className="subtle">Last updated: {PUBLIC_LAST_UPDATED}</span>
          </div>
          <p className="public-kicker">{eyebrow}</p>
          <h1 className="public-info-title">{title}</h1>
          {intro ? <div className="public-info-intro">{intro}</div> : null}
          <PublicPolicyNav className="public-policy-nav" />
        </section>
        {children}
        <PublicFooter />
      </div>
    </main>
  );
}
