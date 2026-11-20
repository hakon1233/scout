// The markdown components an intent doc renders with, matched to the
// editorial tokens: DOC_MARKDOWN for the doc's own page (the profile's scope
// view and the standalone interest page), DOC_CARD_MARKDOWN for a doc card's
// smaller preview. The doc's own h1 sits under the page's h1 (the topic), so
// it renders as an h2.

export const DOC_MARKDOWN = {
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mb-4 font-serif text-title-2 leading-tight text-primary"
      {...p}
    />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="mb-2 mt-7 text-body-sm font-medium text-secondary first:mt-0"
      {...p}
    />
  ),
  h3: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-5 font-serif text-title-3 text-primary" {...p} />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="my-3 font-reading text-body leading-relaxed text-secondary"
      {...p}
    />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="my-3 list-disc space-y-2 pl-6 font-reading text-body leading-relaxed text-secondary"
      {...p}
    />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-3 list-decimal space-y-2 pl-6 font-reading text-body leading-relaxed text-secondary"
      {...p}
    />
  ),
  li: (p: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="pl-1" {...p} />
  ),
  strong: (p: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-primary" {...p} />
  ),
  a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-signal underline underline-offset-2" {...p} />
  ),
  code: (p: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="rounded bg-surface-muted px-1 py-0.5 font-mono text-body-sm text-primary"
      {...p}
    />
  ),
};

export const DOC_CARD_MARKDOWN = {
  h1: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="mt-3 font-serif text-title-3 text-primary first:mt-0"
      {...p}
    />
  ),
  h2: (p: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4
      className="mt-3 text-caption font-medium text-secondary first:mt-0"
      {...p}
    />
  ),
  p: (p: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p
      className="mt-2 font-reading text-body-sm leading-relaxed text-secondary first:mt-0"
      {...p}
    />
  ),
  ul: (p: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="mt-2 list-disc space-y-1 pl-5 font-reading text-body-sm leading-relaxed text-secondary first:mt-0"
      {...p}
    />
  ),
  ol: (p: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="mt-2 list-decimal space-y-1 pl-5 font-reading text-body-sm leading-relaxed text-secondary first:mt-0"
      {...p}
    />
  ),
  li: (p: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="pl-0.5" {...p} />
  ),
  strong: (p: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-primary" {...p} />
  ),
  a: (p: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-signal underline underline-offset-2" {...p} />
  ),
  code: (p: React.HTMLAttributes<HTMLElement>) => (
    <code
      className="rounded bg-surface-muted px-1 py-0.5 font-mono text-body-sm text-primary"
      {...p}
    />
  ),
};
