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
