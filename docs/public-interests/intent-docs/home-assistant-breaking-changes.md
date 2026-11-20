# Home Assistant breaking changes (tested)

**Width:** stayed one project (millions of installs). Contributor-blog deprecations and
beta notes keep the weeks between monthly releases from going empty.

**Score:** run 1 5/6 (the "45 integrations" figure came from third-party guides because
the official section was out of fetch reach). The source changes were added after the
run and are **not re-tested**.

## Intent doc

```markdown
# Home Assistant breaking changes

## Reader

People who run Home Assistant themselves and want to know what an update will break, and what to do, before they install it.

## Report

- The monthly release's backward-incompatible changes, once, in the week it ships: how many integrations, then the ones most users run, each in one line with what to do
- Patch releases (x.y.1, x.y.2 …) that fix regressions, carry security fixes or change behaviour
- Integrations removed or disabled; install methods, platforms or apps losing support
- Security advisories, with severity, CVE and fixed version
- Contributor blog deprecations that will break custom integrations, HACS or apps, with the release they land in
- The coming release's beta notes, once the beta starts

## Skip

New features, dashboards and design, Works with Home Assistant partner news, community events, podcasts, hardware sales, how-to guides, forum help threads, third-party "what's new" posts.

## Sources, check first

- https://github.com/home-assistant/core/releases (patch notes, compact and dated)
- https://contributors.home-assistant.io/blog/ (deprecations; the old developers.home-assistant.io address redirects here)
- https://www.home-assistant.io/security/ (advisories, newest first)
- https://www.home-assistant.io/blog/ (release posts and announcements)

A monthly release post is over 200,000 characters; its backward-incompatible section is near the end and won't fit one fetch. Search "Home Assistant <version> backward-incompatible <integration>" instead, and link the post with #backward-incompatible-changes.

## Search terms

Home Assistant <version> backward-incompatible; Home Assistant integration removed; Home Assistant deprecation <version>; Home Assistant security advisory CVE; Home Assistant <next version> beta

## Each story must state

- Version and release date
- Who is affected: integration, install type (OS, Container, Supervised, Core) or app
- What breaks or changes, and what to do before updating
- For deprecations, the release where it stops working
- Link to the official release, advisory or blog post

## No change

If there is no new release, advisory or deprecation since the last brief, say "No breaking changes since <version, date>." Don't repeat the monthly release in later weeks.

## Language and place

English. Worldwide, UTC.
```

## Test notes

- developers.home-assistant.io redirects (301) to contributors.home-assistant.io, and the
  fetch tool doesn't follow redirects. alerts.home-assistant.io has almost no text.
- Search said the newest advisory was from July; the page had one dated 29 Oct. Only
  fetching the source caught the stale search index.
- Run 1 brief: multicast plugin deprecation (17 Nov), the 2026.11.2 patch with a security
  bump (16 Nov), device-info constants deprecation (10 Nov), the 2026.11 release (4 Nov).
