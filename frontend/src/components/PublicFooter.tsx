import { PublicPolicyNav } from "./PublicPolicyNav";
import { PublicContactDetails } from "./PublicContactDetails";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer-copy">
        <span>Transparent internet social experiment.</span>
        <span>
          Contact: <PublicContactDetails className="inline-link" />
        </span>
      </div>
      <PublicPolicyNav className="public-footer-nav" />
    </footer>
  );
}
