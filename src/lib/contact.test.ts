import assert from "node:assert/strict";
import test from "node:test";

import { CONTACT_EMAIL, contactEmail } from "./contact";

// The contact link must reach a mailbox someone reads: Cloudflare's shared
// domains take no mail, so they never show as a link.
test("the contact address is never on a shared Cloudflare domain", () => {
  assert.equal(contactEmail("privacy@scout-ideas.pages.dev"), null);
  assert.equal(contactEmail("help@scout.workers.dev"), null);
  assert.equal(contactEmail(null), null);
  assert.equal(contactEmail("privacy@example.org"), "privacy@example.org");
  assert.ok(
    CONTACT_EMAIL === null || contactEmail(CONTACT_EMAIL) === CONTACT_EMAIL,
  );
});
