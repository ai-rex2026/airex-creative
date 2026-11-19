-- ノウハウ案の「実装の形」に code（プログラムの変更が要るもの）を足す（2026-11-19）
-- form = note … AI への指示 / legal_rule … 法令チェックの辞書 / code … コード（ロジック）で実装する。承認しても自動では何も反映されない（実装待ちに入る）
-- impl_status … none（対象外）/ todo（実装待ち）/ done（実装済み）。impl_note … 何をどう実装するか
alter table public.knowhow_items drop constraint if exists knowhow_items_form_check;
alter table public.knowhow_items add constraint knowhow_items_form_check check (form in ('note', 'legal_rule', 'code'));
alter table public.knowhow_items add column if not exists impl_status text not null default 'none' check (impl_status in ('none', 'todo', 'done'));
alter table public.knowhow_items add column if not exists impl_note text not null default '';
