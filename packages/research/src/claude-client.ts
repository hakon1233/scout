// The seam between Scout's server code (researchInterest, the hosted chat, the
// run queue's Worker) and the Claude Messages API. Two adapters:
// anthropicClient (plain fetch, for the hosted functions) and recordedClient
// (replays recorded responses, for tests). Host-neutral: fetch and AbortSignal
// only, no Node, Deno or Supabase APIs.

// Only the parts of the Messages API this package reads or sends. Content
// blocks stay loosely typed: researchInterest hands Claude's own blocks back
// unchanged on a pause_turn, so it must never drop a field it doesn't know.
export type ContentBlock = { type: string; [field: string]: unknown };

export type MessagesRequest = {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }>;
  tools?: ContentBlock[];
  // Effort and structured output (the hosted chat's JSON change set).
  output_config?: {
    effort?: "low" | "medium" | "high";
    format?: { type: "json_schema"; schema: Record<string, unknown> };
  };
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  } | null;
};

export type MessagesResponse = {
  content: ContentBlock[];
  stop_reason: string | null;
  usage: Usage;
};

// One Messages API call. Throws on a transport or HTTP error (an HTTP error
// carries its `status`); a tool error inside a 200 is part of the response,
// not a throw.
export interface ClaudeClient {
  createMessage(
    request: MessagesRequest,
    signal: AbortSignal,
  ): Promise<MessagesResponse>;
}

const API_VERSION = "2026-10-21";

// The real adapter. The key comes from the host's secret store; this module
// never reads the environment and never logs the key.
export function anthropicClient(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}): ClaudeClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const url = `${opts.baseUrl ?? "https://api.anthropic.com"}/v1/messages`;
  return {
    async createMessage(request, signal) {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal,
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 300);
        try {
          const err = JSON.parse(text) as {
            error?: { type?: string; message?: string };
          };
          if (err.error)
            detail = `${err.error.type}: ${err.error.message ?? ""}`;
        } catch {
          // Not JSON (a proxy's HTML page): keep the raw start.
        }
        throw Object.assign(new Error(`Claude API ${res.status}: ${detail}`), {
          status: res.status,
        });
      }
      return JSON.parse(text) as MessagesResponse;
    },
  };
}

// The test adapter: answers each call with the next recorded response and
// keeps every request it was sent, so a test can check what went over the
// wire. Running out of responses throws, like a broken connection would.
export function recordedClient(
  responses: MessagesResponse[],
): ClaudeClient & { requests: MessagesRequest[] } {
  const queue = [...responses];
  const requests: MessagesRequest[] = [];
  return {
    requests,
    async createMessage(request, signal) {
      signal.throwIfAborted();
      requests.push(structuredClone(request));
      const next = queue.shift();
      if (!next) throw new Error("recordedClient: no recorded response left");
      return structuredClone(next);
    },
  };
}
