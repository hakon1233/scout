// Request-shape limits for the interest list.
//
// These three numbers are arithmetically coupled, and used to live in three
// different modules: the count in both routes/interests.ts and chat.ts, the
// body cap in http-util.ts. Raising one without the others silently breaks the
// others — lifting the count to 15 while MAX_BODY_BYTES still assumed 6 would
// have turned long or non-ASCII topics into confusing 413s rather than a clear
// validation error. They live together here so the arithmetic is checkable in
// one place.
//
// This module deliberately imports nothing: routes/interests.ts reaches
// chat.ts through routes/types.ts, so a constant shared between them has to
// sit in a leaf or the import cycle puts it in the temporal dead zone.

/** Maximum number of interests a user may hold. */
export const MAX_INTERESTS = 15;

/**
 * Per-interest length bound (PER-137). The count and the body cap bound the
 * other two dimensions; this one stops a single oversized topic being
 * forwarded into the (expensive, ~5-min) Claude synthesis prompt.
 */
export const MAX_INTEREST_LEN = 200;

/**
 * Request-body cap, applied uniformly to every mutating /v0 route via
 * parseJsonBody, so an oversized body cannot blow the companion's memory or
 * reach the synthesis prompt.
 *
 * Sized from the two limits above, at the worst case where every character
 * escapes to a 6-byte \uXXXX sequence:
 *
 *   15 interests x 200 chars x 6 bytes  = 18,000 B
 *   + quoting/commas/JSON framing       ~     85 B
 *   ------------------------------------------------
 *                                       ~ 18,085 B
 *
 * 32 KiB clears that with room to spare. (At 6 interests the old 16 KiB was
 * the equivalent headroom; 15 interests no longer fit inside it.)
 */
export const MAX_BODY_BYTES = 32 * 1024;
