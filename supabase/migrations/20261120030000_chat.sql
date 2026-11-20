-- The hosted setup chat (docs/HOSTED-PLAN.md, Phase 1 task 6): what the
-- Worker's POST /chat and POST /chat/confirm need. Both are service role only;
-- the Worker verifies the reader's JWT first and passes their id.

-- The interest cap the chat prompt states and planChatChanges enforces. Only
-- daily and weekly interests cost anything; this bounds the list itself.
alter table public.plans
  add column max_interests integer not null default 15 check (max_interests > 0);

-- Why the reader may not start a chat turn now, in words for them, or null
-- when they may: the kill switch, the global ceiling, or their daily turn limit.
create function public.chat_block_reason(p_user uuid) returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_allow jsonb;
begin
  if not public.spending_open() then
    return 'Scout has paused new work for today. Try again tomorrow.';
  end if;
  v_allow := public.allowance(p_user);
  if (v_allow -> 'used' ->> 'chat_turns_today')::int
     >= (v_allow -> 'limits' ->> 'chat_turns_per_day')::int then
    return format('You have used today''s %s chat messages. Try again tomorrow.',
                  v_allow -> 'limits' ->> 'chat_turns_per_day');
  end if;
  return null;
end;
$$;

-- One chat turn, in one transaction: apply its changes to the reader's own
-- interests (create, update, soft delete), add the follows (live public
-- interests only), and store the turn. p_turn is core's ChatTurnRow.
create function public.commit_chat_turn(
  p_user uuid, p_turn jsonb, p_follows uuid[], p_cost_usd numeric
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_change jsonb;
begin
  for v_change in select * from jsonb_array_elements(coalesce(p_turn -> 'changes', '[]'))
  loop
    case v_change ->> 'op'
      when 'create' then
        insert into public.interests (id, owner_id, topic, doc)
        values ((v_change ->> 'interestId')::uuid, p_user,
                v_change ->> 'topic', coalesce(v_change ->> 'doc', ''));
      when 'update' then
        update public.interests
        set topic = coalesce(v_change ->> 'topic', topic),
            doc = coalesce(v_change ->> 'doc', doc)
        where id = (v_change ->> 'interestId')::uuid and owner_id = p_user
          and deleted_at is null;
      when 'delete' then
        update public.interests set deleted_at = now()
        where id = (v_change ->> 'interestId')::uuid and owner_id = p_user
          and deleted_at is null;
      else
        raise exception 'commit_chat_turn: unknown op %', v_change ->> 'op';
    end case;
  end loop;

  insert into public.follows (user_id, interest_id)
  select p_user, i.id from public.interests i
  where i.id = any(coalesce(p_follows, '{}')) and i.visibility = 'public'
    and i.deleted_at is null and i.owner_id <> p_user
  on conflict do nothing;

  insert into public.chat_turns
    (id, user_id, message, reply, changes, pending, status, cost_usd, error_msg, created_at)
  values (
    (p_turn ->> 'id')::uuid, p_user, p_turn ->> 'message', p_turn ->> 'reply',
    nullif(p_turn -> 'changes', 'null'::jsonb), nullif(p_turn -> 'pending', 'null'::jsonb),
    p_turn ->> 'status', greatest(coalesce(p_cost_usd, 0), 0), p_turn ->> 'error_msg',
    coalesce((p_turn ->> 'created_at')::timestamptz, now()));
end;
$$;

revoke execute on function public.chat_block_reason(uuid),
  public.commit_chat_turn(uuid, jsonb, uuid[], numeric)
  from public, anon, authenticated;
grant execute on function public.chat_block_reason(uuid),
  public.commit_chat_turn(uuid, jsonb, uuid[], numeric)
  to service_role;
