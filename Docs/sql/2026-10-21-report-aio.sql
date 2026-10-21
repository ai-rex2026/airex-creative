-- URLレポートの「AI検索での見え方（AIO）」（lib/report-aio.ts）。冪等。
alter table public.analyses add column if not exists aio jsonb;
