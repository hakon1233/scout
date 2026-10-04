# Companion releases are immutable directories named by commit, switched by symlink

The companion is deployed with `scripts/release-agent.mjs`, not by running from a
checkout. Each release is built into a read-only directory named by its full Git SHA,
and a `current` symlink is switched atomically. The deploy:

- refuses source that is dirty or not pushed;
- waits until no run or chat turn is in flight;
- rolls back to the previous release if the readiness and provenance checks fail.

`GET /v0/version` reports the SHA that is live. Running from a working tree was
simpler, but any rebuild or uncommitted edit in that tree changed the code serving the
reader's real data. The cost is a few hundred lines of release tooling.
