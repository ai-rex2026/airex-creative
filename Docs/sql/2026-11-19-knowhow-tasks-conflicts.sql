-- ノウハウ案：適用する用途（tasks）と、既存のルール・承認済みの案との矛盾チェック（2026-11-19）
-- tasks … 空なら領域のすべての用途に足す（従来どおり）。値があれば、その用途の AI 呼び出しにだけ足す
-- conflicts … 矛盾の疑い [{with, kind, why}]。conflict_ok … 管理者が矛盾を確認した上で承認してよいとした印
alter table public.knowhow_items add column if not exists tasks text[] not null default '{}';
alter table public.knowhow_items add column if not exists conflicts jsonb not null default '[]'::jsonb;
alter table public.knowhow_items add column if not exists conflict_checked_at timestamptz;
alter table public.knowhow_items add column if not exists conflict_ok boolean not null default false;
