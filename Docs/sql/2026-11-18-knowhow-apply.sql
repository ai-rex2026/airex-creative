-- ノウハウ更新案：承認したものを実際のルールに反映するための列（2026-11-18）
-- form = note … 短い文を、領域の AI への指示に追加する（applied_text が追加される文。管理者が承認の前に直せる）
-- form = legal_rule … 法令チェックの辞書に加える（rule = {pattern, reason, law, suggestion, industries?}）
alter table public.knowhow_items add column if not exists form text not null default 'note' check (form in ('note', 'legal_rule'));
alter table public.knowhow_items add column if not exists applied_text text not null default '';
alter table public.knowhow_items add column if not exists rule jsonb;

update public.knowhow_items set applied_text = 'Googleマップの質問と回答（Q&A）機能は廃止された。よくある質問への答えは、ビジネスプロフィールの属性・説明文と、公式サイトのFAQに載せる施策として提案する。'
  where key = 'meo-qa-retired' and applied_text = '';
update public.knowhow_items set applied_text = 'ビジネスプロフィールの本人確認は動画認証が主流になっている。認証が済んでいない場合は、認証を最優先のやることとして挙げる。'
  where key = 'meo-video-verify' and applied_text = '';
update public.knowhow_items set applied_text = '写真の更新・口コミへの返信・営業時間の正確さ・電話や経路検索などの行動の月次確認を、やることに含めてよい。ただし、順位が上がるとは断定しない。'
  where key = 'meo-engagement' and applied_text = '';
update public.knowhow_items set applied_text = '記事では、各見出しの直後に、その節の結論を先に書く50〜150字ほどの短い要約を置く。'
  where key = 'aio-answer-first' and applied_text = '';
update public.knowhow_items set form = 'legal_rule',
  rule = '{"pattern":"(私は|わたしは|私たちは)[^。]{0,30}(社員|従業員|スタッフ)(です|として)","reason":"所属を示すだけでは、事業者の表示（広告）と一般消費者に明瞭とは言えない","law":"景表法（ステルスマーケティング告示）","suggestion":"「広告」「PR」などの表示、または商品・サービスの提供を受けている旨を明記する"}'::jsonb
  where key = 'legal-keihyo-2026' and rule is null;
