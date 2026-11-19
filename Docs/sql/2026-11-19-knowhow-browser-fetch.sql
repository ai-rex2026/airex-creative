-- ブラウザ表示で本文を取る（Apify）の1日あたりの回数の上限。fetch の直前に claim_knowhow_render_call を通す。
create table if not exists public.knowhow_render_calls (
  day text primary key,
  calls int not null default 0
);
alter table public.knowhow_render_calls enable row level security; -- 方針なし＝サービス側だけ

create or replace function public.claim_knowhow_render_call(p_day text, p_max int) returns boolean
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.knowhow_render_calls (day, calls) values (p_day, 1)
  on conflict (day) do update set calls = public.knowhow_render_calls.calls + 1
  returning calls into n;
  if n > p_max then
    update public.knowhow_render_calls set calls = calls - 1 where day = p_day;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.claim_knowhow_render_call(text, int) from public, anon, authenticated;

-- 取得の方法：auto＝まず普通に取り、取れない・本文が少ないときだけブラウザ表示。browser＝いつもブラウザ表示
alter table public.knowhow_sources add column if not exists fetch_mode text not null default 'auto' check (fetch_mode in ('auto','browser'));

-- 手動点検だった3ページを、自動で取得するページに移す（ブラウザ表示で取る）
insert into public.knowhow_sources (key, area, title, url, official, note, fetch_mode)
select key, area, title, url, true, note, 'browser' from public.knowhow_manual_checks
on conflict (key) do nothing;
-- 旧キーとの重複（Microsoft はすでに microsoft-ads-policy-blog がある）は止める
update public.knowhow_sources set enabled = false where key = 'microsoft-ads-policy';
update public.knowhow_sources set fetch_mode = 'browser' where key in ('meta-ad-standards','x-ads-policy-log','microsoft-ads-policy-blog');
