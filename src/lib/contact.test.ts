import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTACT_EMAIL,
  CONTACT_PLACEHOLDER,
  contactEmail,
  contactLine,
} from "./contact";

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

// Until a real mailbox is set, Privacy and Terms still show a contact line:
// the placeholder, as text, never a link.
test("the contact line is the address, or the placeholder while none is set", () => {
  assert.deepEqual(contactLine(null), {
    kind: "placeholder",
    text: CONTACT_PLACEHOLDER,
  });
  assert.deepEqual(contactLine("privacy@scout-ideas.pages.dev"), {
    kind: "placeholder",
    text: CONTACT_PLACEHOLDER,
  });
  assert.deepEqual(contactLine("privacy@example.org"), {
    kind: "email",
    text: "privacy@example.org",
  });
  assert.match(CONTACT_PLACEHOLDER, /@/);
});
