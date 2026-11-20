// The one contact address Privacy, Terms and the hidden-topic notice show.
// PLACEHOLDER: null until the owner sets a mailbox they control. Never a
// *.pages.dev or *.workers.dev address: mail there bounces.
export const CONTACT_EMAIL: string | null = null;

/** A real, deliverable address, or null while none is set. */
export function contactEmail(
  value: string | null = CONTACT_EMAIL,
): string | null {
  if (!value) return null;
  const domain = value.split("@")[1]?.toLowerCase() ?? "";
  if (!domain || /(^|\.)(pages|workers)\.dev$/.test(domain)) return null;
  return value;
}

// What Privacy, Terms and the notice show while no address is set: plainly a
// placeholder, as text, never a link.
export const CONTACT_PLACEHOLDER =
  "privacy@<your domain> (placeholder until launch)";

/** The contact line to show: the real address, or the placeholder. */
export function contactLine(value: string | null = CONTACT_EMAIL): {
  kind: "email" | "placeholder";
  text: string;
} {
  const email = contactEmail(value);
  return email
    ? { kind: "email", text: email }
    : { kind: "placeholder", text: CONTACT_PLACEHOLDER };
}
