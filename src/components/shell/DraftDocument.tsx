import * as React from "react";
import { AppShell, PageHeader } from "./AppShell";

/** The contact address on Privacy, Terms and the hidden-topic notice. */
export const CONTACT_EMAIL = "privacy@scout-ideas.pages.dev";

/** The address as a link, marked as a placeholder until launch. */
export function ContactEmail() {
  return (
    <>
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> (placeholder until
      launch)
    </>
  );
}

// Privacy and Terms: a plain reading page marked Draft until a lawyer reads it.
export function DraftDocument({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <PageHeader
        title={title}
        back={{ href: "/app/settings/", label: "Settings" }}
      >
        <span className="font-medium text-warning">Draft</span> · Last changed{" "}
        {updated}
      </PageHeader>
      <article
        data-main
        className="flex max-w-[65ch] flex-col gap-4 text-body text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-4 [&_h2]:font-serif [&_h2]:text-title-3 [&_li]:ml-5 [&_li]:list-disc [&_p]:text-pretty [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5"
      >
        {children}
      </article>
    </AppShell>
  );
}
