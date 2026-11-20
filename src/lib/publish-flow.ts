import { HostedError, type HostedData } from "./hosted";

// Making a topic public: the steps the publish sheet shows. Scout's server
// checks the topic first (publish()); a refusal is an answer with a reason,
// a limit is a HostedError "limit", and a signed-out reader is thrown on so
// the page can send them to sign in.

export type PublishState =
  | { kind: "ask" }
  | { kind: "checking" }
  | { kind: "public"; slug: string; tags: string[] }
  | { kind: "refused"; reason: string }
  | { kind: "limit"; message: string }
  | { kind: "failed"; message: string };

export async function checkAndPublish(
  data: Pick<HostedData, "publish">,
  interestId: string,
): Promise<PublishState> {
  try {
    const result = await data.publish(interestId);
    return result.status === "public"
      ? { kind: "public", slug: result.slug, tags: result.tags }
      : { kind: "refused", reason: result.reason };
  } catch (err) {
    if (err instanceof HostedError) {
      if (err.kind === "signed-out") throw err;
      if (err.kind === "limit") return { kind: "limit", message: err.message };
      return { kind: "failed", message: err.message };
    }
    return {
      kind: "failed",
      message: "Scout couldn't check it right now. Try again.",
    };
  }
}

/** Whether the reader may make one more topic public. */
export function hasPublicRoom(used: number, limit: number): boolean {
  return used < limit;
}

/** "1 follower", "12 followers", "1.4k followers". */
export function followersLabel(n: number): string {
  const count =
    n >= 1000
      ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`
      : String(n);
  return `${count} ${n === 1 ? "follower" : "followers"}`;
}
