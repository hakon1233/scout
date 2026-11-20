"use client";

import { CONTACT_EMAIL, DraftDocument } from "@/components/shell/DraftDocument";

export default function TermsPage() {
  return (
    <DraftDocument title="Terms" updated="20 November 2026">
      <p>By using Scout you agree to these terms.</p>

      <h2>Briefs are written by AI</h2>
      <p>
        An AI researches and writes every brief. It can get facts wrong, miss
        news or misread a source. Check the linked sources before you rely on a
        story, and don&apos;t use a brief as financial, legal or medical advice.
      </p>

      <h2>Public topics</h2>
      <p>
        When you make a topic public or share its link, don&apos;t use it to:
      </p>
      <ul>
        <li>harass, threaten or target a person;</li>
        <li>spread hate, sexual content or content that breaks the law;</li>
        <li>mislead people on purpose or impersonate someone;</li>
        <li>advertise or spam.</li>
      </ul>
      <p>
        We may hide or remove a topic that breaks these rules, or that we think
        harms Scout or its readers, and we may close accounts that keep doing
        it.
      </p>

      <h2>Plans and limits</h2>
      <p>
        Free and paid plans have limits on topics and runs, shown in Settings.
        We may change them, and we will tell you before a change makes your plan
        smaller.
      </p>

      <h2>No guarantee</h2>
      <p>
        Scout is offered as it is. Runs can fail or be late, and we may change
        or stop the service.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </DraftDocument>
  );
}
