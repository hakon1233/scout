"use client";

import { ContactEmail, DraftDocument } from "@/components/shell/DraftDocument";

export default function PrivacyPage() {
  return (
    <DraftDocument title="Privacy" updated="20 November 2026">
      <p>
        Scout writes you a news brief about the topics you choose. This page
        says what we keep about you to do that, who helps us, and how to get it
        deleted.
      </p>

      <h2>What we keep</h2>
      <ul>
        <li>Your account email, to sign you in.</li>
        <li>
          Your topics: what you asked Scout to follow, their settings and the
          briefs written for them.
        </li>
        <li>
          Profile fields you choose to fill in, such as a display name. They are
          optional.
        </li>
        <li>The stories you like and save.</li>
        <li>
          Which stories you open and how long you spend on each. We use this
          only to suggest topics and to offer to mute ones you skip.
        </li>
        <li>
          Push subscriptions for the devices where you turn on notifications.
        </li>
      </ul>
      <p>We don&apos;t sell your data and we don&apos;t show ads.</p>

      <h2>Who helps us</h2>
      <ul>
        <li>Supabase stores your account and data.</li>
        <li>Cloudflare hosts the app and runs the code that sends pushes.</li>
        <li>
          Anthropic&apos;s Claude researches and writes the briefs. It sees your
          topics, not your email.
        </li>
      </ul>

      <h2>Public topics</h2>
      <p>
        A topic you make public, and the briefs written for it, can be read by
        anyone, with your display name or none. A link-only topic can be read by
        anyone who has the link.
      </p>

      <h2>Deleting your data</h2>
      <p>
        Delete your account in Settings and we delete your account, topics,
        briefs, likes, saves, reading data and push subscriptions. Readers who
        followed your public topics stop getting them.
      </p>

      <h2>A copy of your data</h2>
      <p>
        Email us at <ContactEmail /> and we will send you a copy of what we keep
        about you.
      </p>
    </DraftDocument>
  );
}
