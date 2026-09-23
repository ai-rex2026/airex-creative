# 広告媒体の連携（設定画面）

設定画面の「広告アカウント連携」から、各媒体の広告アカウントを OAuth で連携する。
連携しても、このツールは実績の**読み取りだけ**に使い、広告の変更はしない。

- 開始：`/api/ads/{媒体}/start` → 媒体の認可画面 → `/api/ads/{媒体}/callback` → `/settings`
- 媒体 id：`google` / `yahoo` / `meta` / `microsoft` / `tiktok` / `x`
- トークンは `ad_connections`（RLS 有効・ポリシーなし＝ブラウザから読めない）に service role だけが書く
- 実績取得側は `lib/ads/tokens.ts` の `getAdCredentials(userId, platform)` を呼ぶ。期限が近ければ更新して返す

## 環境変数（Vercel）

| 媒体 | 必須 |
|---|---|
| Google 広告 | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET`（ログイン用と共通） |
| ヤフーLINE広告（旧 Yahoo!広告） | `YAHOO_ADS_CLIENT_ID` `YAHOO_ADS_CLIENT_SECRET` |
| Meta 広告 | `META_APP_ID` `META_APP_SECRET`（Instagram 連携と共通） |
| Microsoft 広告 | `MICROSOFT_CLIENT_ID` `MICROSOFT_CLIENT_SECRET` `MICROSOFT_DEVELOPER_TOKEN` |
| TikTok 広告 | `TIKTOK_APP_ID` `TIKTOK_SECRET` |
| X 広告 | `X_API_KEY` `X_API_SECRET`（コンシューマーキー。**OAuth 1.0a**） |

> `GOOGLE_ADS_DEVELOPER_TOKEN` は **必須ではない**。Google Cloud プロジェクトのアクセスレベルを
> 「テスト」から「エクスプローラ」に上げれば、開発者トークンなしで MCC 配下の取得・選択保存・
> 実績取得が動く（2026-09 に本番で確認済み）。あれば `lib/ads/google.ts` が自動でヘッダーに付ける。

任意：

- `AD_TOKEN_ENC_KEY` … `openssl rand -base64 32`。設定すると保存するトークンを AES-256-GCM で暗号化する
- `APP_ORIGIN` … リダイレクトURIの origin を固定したいとき（例 `https://xxxx.vercel.app`）。未設定ならアクセスされたホストを使う
- `GOOGLE_ADS_API_VERSION`（既定 `v24`）／`X_ADS_API_BASE`（既定 `https://ads-api.x.com/12`）／`YAHOO_ADS_API_BASE`（既定 `https://ads-search.yahooapis.jp/api/v19`）

## 各媒体の開発者ポータルに登録するリダイレクトURI

`{APP_ORIGIN}/api/ads/{媒体}/callback`

- Google：OAuth クライアントの「承認済みのリダイレクト URI」に追加。スコープ `adwords`
- ヤフーLINE広告：アプリのコールバック URL に追加。スコープ `yahooads`
- Meta：アプリの「有効な OAuth リダイレクト URI」に追加。権限 `ads_read`（審査前は開発者・テスターのみ）
- Microsoft：Azure のアプリ登録（Web）にリダイレクトURIを追加
- TikTok：アプリの Redirect URL に追加
- X：アプリの Callback URL に追加。**Ads API の利用承認が別途必要**

## DB

```sql
create table if not exists public.ad_connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('google','yahoo','meta','microsoft','tiktok','x')),
  access_token text,
  refresh_token text,
  token_secret text,
  token_expires_at timestamptz,
  accounts jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, platform)
);
alter table public.ad_connections enable row level security;
revoke all on public.ad_connections from anon, authenticated;
```

## 対象アカウント一覧の取得状況

連携（OAuth・トークン保存）自体は6媒体とも同じ仕組みで動く（`lib/ads/oauth.ts`）。
連携直後にどの広告アカウントが読めるかを控える `discoverAccounts`（`lib/ads/accounts.ts`）は媒体ごとに実装が要る：

| 媒体 | 状態 |
|---|---|
| Google | 実装済み・本番で確認済み |
| ヤフーLINE広告 | 実装済み・本番で確認済み（`lib/ads/yahoo.ts`。連携直後の `BaseAccountService/get`（セレクタなし）は自分の直接権限分だけを返す。MCC配下の全体は下記の「分析対象アカウントの選択」で別途取る。分析対象アカウントの選択UIも実装済み、`components/YahooAccountPicker.tsx`） |
| Meta / TikTok / X | 実装済み（未検証） |
| Microsoft | 実装（`lib/ads/microsoft.ts`）。Customer Management Service は SOAP のみ（REST版なし、2026-09 Microsoft Learn で確認）。GetUser→SearchAccounts の手順・リクエスト形式は公式ドキュメントの実例どおりだが、**レスポンスのXMLタグ構成は未検証** |

取得に失敗しても連携自体（トークン保存）は成功する。設定画面には「アカウント一覧を取れませんでした：〜」という注記が出るので、実際に連携して確認し、ずれていれば `lib/ads/yahoo.ts` / `lib/ads/microsoft.ts` を直す。

## 分析対象アカウントの選択

新規分析画面（`/analysis/new`）で、連携済みの媒体ごとに「どのアカウントを分析するか」を選んで
`ad_connections.meta.selected` に保存する。MCC（管理者アカウント）自体は実績を持たないため選べない。

| 媒体 | 状態 |
|---|---|
| Google | 実装済み（`components/AdAccountPicker.tsx`）。MCC を開いて配下を辿れる（`googleChildAccounts`、`customer_client` を `login-customer-id` 付きで検索） |
| ヤフーLINE広告 | 実装済み（`components/YahooAccountPicker.tsx`）。Google と同じ「MCC を開いて配下を辿る」UI。配下の列挙は **AccountLinkService/get**（`selector: { mccAccountId }`、`x-z-base-account-id: MCCのID` ヘッダー必須。公式OpenAPI定義・本番エラー両方で確認済み）で行い、`lib/ads/yahoo.ts` の `yahooChildAccounts` に実装済み（本番で配下が正しく列挙されることを確認済み）。名前はまず `BaseAccountService/get` の `accountIds` セレクタで一括引き直しを試みるが、NON_OWNER（他企業＝クライアント）の子アカウントでは `totalNumEntries: 0` で返らないことを本番で確認済み。当初「代理店ビジネスIDに直接の操作権限がないため」と判断したが、ユーザーに実際の管理画面での見え方を確認したところ、MCCの管理画面上ではこれらNON_OWNERアカウントも名前付きで表示され、クリックしてキャンペーンまで操作できるとのことで、この判断は誤りだったと判明（ログイン中のブラウザセッションは十分な権限を持っている）。そこで、一括取得で名前が引けなかった子アカウントだけ `AccountService/get` に `x-z-base-account-id: そのアカウント自身のID` を指定して1件ずつ追加でリトライするように変更（本番で動作確認中）。それでも引けない場合は ID をそのまま名前として表示する（選べなくはしない） |
| Meta / Microsoft / TikTok / X | 未実装 |

## 未実装（次の段階）

- 各媒体の実績取得（`lib/ads/google.ts` の `fetchCampaignMetrics` 相当）と `UnifiedCampaignMetric` への正規化。いまは Google 広告のみ（`app/ad-performance-actions.ts`）
- Meta / Microsoft / TikTok / X の分析対象アカウント選択UI
- 実績（費用・CV・CPA・ROAS）を「伸びしろ診断」の分析に接続する部分
