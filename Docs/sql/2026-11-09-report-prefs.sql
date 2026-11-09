-- レポートの表示設定と作り直しの指示（2026-11-09。lib/report-sections.ts）
alter table public.analyses add column if not exists report_prefs jsonb;
-- チャットが出した「作り直しの提案」（確認ボタン用）
alter table public.chat_messages add column if not exists proposals jsonb;
