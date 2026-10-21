-- Search Console / GA4 の連携で、どの Google アカウントで許可したか（ログインと別のアカウントで連携できるようにしたため）。冪等。
alter table public.google_connections add column if not exists email text;
