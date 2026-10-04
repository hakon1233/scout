# Scout

Scout turns a reader's interests into a short, dated news brief. The research runs on the
reader's own machine through their Claude Code CLI; the website only shows the result.

## Language

### Reader's setup

**Interest**:
Something the reader wants news about, with a stable id and a short **topic** (its headline).
_Avoid_: subscription, feed item

**Topic**:
The short headline of an interest, also used verbatim as the heading of its section in a brief.
_Avoid_: tag, category

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

**Story**:
One dated item in a section: a one-line summary, its source links, an optional source image
and an in-depth body.
_Avoid_: article (the UI's type name), item, post

**Coverage**:
Whether each topic of a run came back covered (has stories), empty (the model found no fresh
news) or missing (its session failed or the section was dropped).

**Basis**:
The exact topic and intent doc a run used for one interest, kept with the brief.

**Search skills**:
The fixed research rules given to the model on every run (recency, dates, source quality,
story format).

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
