-- 重複・類似の案を一覧から除く。dup_of＝似ている元の案（消さない。画面から戻せる）
alter table public.knowhow_items add column if not exists dup_of uuid references public.knowhow_items(id) on delete set null;
create index if not exists knowhow_items_dup_of_idx on public.knowhow_items (dup_of) where dup_of is not null;
