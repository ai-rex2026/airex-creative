-- SNS取得を1分析につき同時に1つだけにするための取得権（2026-10-05）。
-- 取得権は p_ttl_seconds 秒で失効する（取得中にプロセスが落ちても次のtickが引き継げる）。
alter table analyses add column if not exists social_scan_claimed_at timestamptz;

create or replace function claim_social_scan(p_id text, p_ttl_seconds integer)
returns boolean
language plpgsql
as $$
declare
  n integer;
begin
  update analyses
  set social_scan_claimed_at = now()
  where id = p_id
    and (social_scan_claimed_at is null
         or social_scan_claimed_at < now() - make_interval(secs => p_ttl_seconds));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

notify pgrst, 'reload schema';
