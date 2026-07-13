import { CONTACT_EMAIL_FALLBACK, getPublicContactEmail } from "../public/content";

type PublicContactDetailsProps = {
  className?: string;
};

export function PublicContactDetails({ className = "" }: PublicContactDetailsProps) {
  const email = getPublicContactEmail();
  if (!email) {
    return <span className={className}>{CONTACT_EMAIL_FALLBACK}</span>;
  }
  return (
    <a className={className} href={`mailto:${email}`}>
      {email}
    </a>
  );
}
