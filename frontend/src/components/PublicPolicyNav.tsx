import { Link } from "react-router-dom";

const PUBLIC_LINKS = [
  { to: "/experiment", label: "Experiment" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/refunds", label: "Refunds" },
  { to: "/contact", label: "Contact" },
];

type PublicPolicyNavProps = {
  className?: string;
};

export function PublicPolicyNav({ className = "" }: PublicPolicyNavProps) {
  return (
    <nav className={className} aria-label="Public site links">
      {PUBLIC_LINKS.map((link) => (
        <Link key={link.to} to={link.to}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
