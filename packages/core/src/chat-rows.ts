// A hosted chat turn as a `chat_turns` row (supabase/migrations) and back.
// The Worker writes rows and the web app reads them, so both use this one
// mapping. Pending proposals share one `pending` jsonb column, and so does
// the reply's page link (not a proposal, but it saves a migration).

import type {
  AppPage,
  ChatChange,
  ChatTurn,
  PendingCreate,
  PendingDelete,
  PendingFollow,
  PendingRewrite,
} from "./contract.ts";

export type ChatTurnRow = {
  id: string;
  created_at: string;
  status: ChatTurn["status"];
  message: string;
  reply: string | null;
  changes: ChatChange[] | null;
  pending: {
    deletes?: PendingDelete[];
    rewrite?: PendingRewrite;
    follows?: PendingFollow[];
    creates?: PendingCreate[];
    page?: AppPage;
  } | null;
  error_msg: string | null;
};

export function chatTurnToRow(turn: ChatTurn): ChatTurnRow {
  const pending: NonNullable<ChatTurnRow["pending"]> = {};
  if (turn.pending_deletes?.length) pending.deletes = turn.pending_deletes;
  if (turn.pending_rewrite) pending.rewrite = turn.pending_rewrite;
  if (turn.pending_follows?.length) pending.follows = turn.pending_follows;
  if (turn.pending_creates?.length) pending.creates = turn.pending_creates;
  if (turn.page) pending.page = turn.page;
  return {
    id: turn.id,
    created_at: turn.created_at,
    status: turn.status,
    message: turn.message,
    reply: turn.reply ?? null,
    changes: turn.changes ?? null,
    pending: Object.keys(pending).length > 0 ? pending : null,
    error_msg: turn.error_msg ?? null,
  };
}

export function chatTurnFromRow(row: ChatTurnRow): ChatTurn {
  const deletes = row.pending?.deletes ?? [];
  return {
    id: row.id,
    created_at: row.created_at,
    status: row.status,
    message: row.message,
    ...(row.reply !== null ? { reply: row.reply } : {}),
    ...(row.changes !== null ? { changes: row.changes } : {}),
    ...(deletes.length > 0
      ? { pending_deletes: deletes, pending_delete: deletes[0] }
      : {}),
    ...(row.pending?.rewrite ? { pending_rewrite: row.pending.rewrite } : {}),
    ...(row.pending?.follows?.length
      ? { pending_follows: row.pending.follows }
      : {}),
    ...(row.pending?.creates?.length
      ? { pending_creates: row.pending.creates }
      : {}),
    ...(row.pending?.page ? { page: row.pending.page } : {}),
    ...(row.error_msg !== null ? { error_msg: row.error_msg } : {}),
  };
}
