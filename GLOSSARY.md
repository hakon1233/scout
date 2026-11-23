# Scout

Scout turns a reader's interests into a short, dated news brief. The research runs on the
reader's own machine through their Claude Code CLI; the website only shows the result.

## Language

### Reader's setup

**Interest**:
Something the reader wants news about, with a stable id and a short **topic** (its headline).
On screen it is called a **topic** ("Topics", "New topic", "Manage topics"); the word
"interest" stays in code, the HTTP contract and the database only.
Naming rule: code and database names stay "interest" (tables, columns, core types, the
contract, `interestId`). On-screen text, and the names of UI components and routes, may
say "topic" (`HostedTopics`, `TopicCard`, `/app/topics/`). The public catalog's SQL
functions that already say topic (`browse_topics`, `set_topic_tags`, `report_topic`)
keep their names; new database names say interest.
_Avoid_: subscription, feed item; "interest" in any on-screen text

**Topic**:
The short headline of an interest, also used verbatim as the heading of its section in a brief.
_Avoid_: tag, category

**Visibility**:
Who may follow an interest: private (only its owner), shared (anyone with its share link)
or public (in the catalog the setup chat suggests; an admin's call). A follower gets the
host's briefs for that interest and pays nothing; the runs count on the host's plan.
_Avoid_: published, subscribed

**Intent doc**:
A short markdown note per interest that says what the reader wants from it; it is given to
the model word for word on every run.
_Avoid_: profile, prompt, scope doc

**Companion**:
The small local program (`scout-agent`) that stores the reader's interests and briefs and runs
the research. The website talks only to the companion.
_Avoid_: agent (except in the binary and package name), backend, server

**Pairing token**:
The secret that proves a browser may use a given companion.
_Avoid_: API key, session

**Hosted UI**:
The copy of the website on GitHub Pages; it reaches the reader's companion over loopback.

### Briefs

**Run**:
One pass of research over the reader's interests that produces a brief; one research
session per interest.
_Avoid_: job, sync, refresh

**Ephemeral run**:
A test or dry run whose brief is never shown as the reader's real edition.

**Brief**:
The dated markdown edition a run produces: one section per topic. A **weekly brief** is a
digest assembled from the past week's briefs without new research.
_Avoid_: digest (except weekly), report, newsletter

**Section**:
The part of a brief under one topic's heading.

**Make topic**:
An interest whose `mode` is `make`: each run Scout writes one piece itself (a bedtime story,
a word of the day) with no web search, instead of researching news. The piece is one story
with no source link; its title is the key in the topic's "already sent" list
(`interests.sent_keys`, the last 60), so a piece never repeats. Off unless `settings.make_on`.
_Avoid_: creative topic, generated topic

**Story**:
One dated item in a section: a one-line summary, its source links, an optional source image
and an in-depth body.
_Avoid_: article (the UI's type name), item, post

**Coverage**:
Whether each topic of a run came back covered (has stories), empty (nothing cleared the
relevance bar, so the section says "No change since <date>." or "No news yet.") or missing
(its session failed or the section was dropped).

**Brief settings**:
Per interest: how long its section is, how many stories it may carry (a number, or only
the relevant ones), whether old items still count (evergreen), and which locale to search
in and language to write in. Every run's prompt uses them.
_Avoid_: preferences, options

**Basis**:
The exact topic and intent doc a run used for one interest, kept with the brief.

**Search skills**:
The fixed research rules given to the model on every run (recency, dates, source quality,
story format).

**Relevance skills**:
The fixed rules for when a story earns a place in a section. A run that finds nothing
relevant enough posts nothing rather than pad.

**Assembly skills**:
The plain-language description of how sections become one ordered brief; enforced in code,
shown on the skills page, never sent to the model.

**Liked story**:
A story the reader saved; kept only in that browser.
_Avoid_: favourite, bookmark

### Chat

**Chat turn**:
One message from the reader to the interest assistant and its reply.

**Change set**:
The interest changes a chat turn proposes: create, update or delete an interest, or rewrite
its intent doc.

**Pending delete / pending rewrite**:
A delete or full rewrite that a chat turn proposes but that waits for the reader to confirm.
Creates and updates apply at once.

### Schedule

**Schedule**:
The reader's daily time for an automatic run.

## Flagged ambiguities

- The UI and its types call a story an `Article` (`parseArticlesFromMarkdown`). Story is the
  word the brief, the prompts and the feed copy use.
- The CLI and package are named `scout-agent` / `@scout/agent`, while the UI and docs say
  companion.
