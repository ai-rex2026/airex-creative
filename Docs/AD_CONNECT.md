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
| Microsoft | 実装（`lib/ads/microsoft.ts`）。Customer Management Service は SOAP のみ（REST版なし、2026-09 Microsoft Learn で確認）。GetUser→SearchAccounts の手順・リクエスト形式は公式ドキュメントの実例どおりだが、**レスポンスのXMLタグ構成は未検証**（GetUser の `CustomerId`、SearchAccounts の各アカウントの `ParentCustomerId` も同じく未検証。下記の分析対象アカウントの選択・実績取得で使う） |

取得に失敗しても連携自体（トークン保存）は成功する。設定画面には「アカウント一覧を取れませんでした：〜」という注記が出るので、実際に連携して確認し、ずれていれば `lib/ads/yahoo.ts` / `lib/ads/microsoft.ts` を直す。

## 分析対象アカウントの選択

新規分析画面（`/analysis/new`）で、連携済みの媒体ごとに「どのアカウントを分析するか」を選んで
`ad_connections.meta.selected` に保存する。MCC（管理者アカウント）自体は実績を持たないため選べない。

| 媒体 | 状態 |
|---|---|
| Google | 実装済み（`components/AdAccountPicker.tsx`）。MCC を開いて配下を辿れる（`googleChildAccounts`、`customer_client` を `login-customer-id` 付きで検索） |
| ヤフーLINE広告 | 実装済み（`components/YahooAccountPicker.tsx`）。Google と同じ「MCC を開いて配下を辿る」UI。配下の列挙は **AccountLinkService/get**（`selector: { mccAccountId }`、`x-z-base-account-id: MCCのID` ヘッダー必須。公式OpenAPI定義・本番エラー両方で確認済み）で行い、`lib/ads/yahoo.ts` の `yahooChildAccounts` に実装済み（本番で配下が正しく列挙されることを確認済み）。**名前解決について最終結論（2026-09）**：名前は `BaseAccountService/get` の `accountIds` セレクタで一括取得するが、NON_OWNER（他企業＝クライアント）の子アカウントは、そのアカウント側で連携ビジネスIDが「担当者」として直接登録されていない限り `totalNumEntries: 0` で名前が引けない。MCCとのアカウントリンクだけでは不足（ユーザーが対象アカウントの「権限管理＞ユーザー」で確認済み：MCCリンクだけのビジネスIDはそこに現れない）。引けない名前は ID をそのまま表示し、`nameLookupError` としてUIに「広告アカウント自体の権限がない場合は広告アカウント名の取得は不可」という注意書きを出す（選べなくはしない）。保存は `saveYahooSelection`（`YahooSelection = { id, name, mccId }`）で、`mccId` は下記の実績取得で使う |
| Microsoft | 実装済み（**未検証**。`components/MicrosoftAccountPicker.tsx`）。SearchAccounts がアクセスできる広告アカウントをすでにフラットな一覧で返す（Google/ヤフーLINE広告のような MCC 配下の展開が不要）ため、一覧から直接チェックして保存するだけの単純なUI。保存は `saveMicrosoftSelection`（`MicrosoftSelection = { id, name, customerId }`）で、`customerId`（＝対象アカウントの `ParentCustomerId`）は保存のたびに Microsoft から取り直して検証する（キャッシュしない） |
| Meta / TikTok / X | 未実装 |

## 実績取得（キャンペーン別）

| 媒体 | 状態 |
|---|---|
| Google | 実装済み・本番で確認済み（`lib/ads/google.ts` の `fetchCampaignMetrics`。`googleAds:search` の同期検索） |
| ヤフーLINE広告 | 実装済み・本番で確認済み（2026-09）。`lib/ads/yahoo.ts` の `fetchCampaignMetrics`：① `CampaignService/get` でキャンペーンの id・名前・ステータスを同期取得、② `ReportDefinitionService`（`getReportFields` でフィールド名を動的解決 → `add` でジョブ作成 → `get` でポーリング → `download` でTSV取得）で費用・表示回数・クリック等を非同期取得。**`x-z-base-account-id` ヘッダーの仕様（本番エラーで確定）**：このヘッダーには「アクセストークンが直接の base account として持つアカウント」（MCC自身、または直接権限を持つ自分のアカウント）しか指定できない。子アカウント自身のIDを渡すと `HTTP 401 {"code":"0117","message":"Account(specified by x-z-base-account-id) not found."}`。Google広告の login-customer-id（MCC）＋ customer-id（対象アカウント）と同じパターンで、ヘッダーには常に base account（`YahooSelection.mccId`、直下選択で null の場合はアカウント自身のID）を渡し、実際に取得したい対象アカウントは各リクエスト body の `accountId` で指定する。これにより MCCリンクだけの子アカウント（NON_OWNER、名前解決はできないもの）でもキャンペーン・実績データ自体は取得できることを確認済み（名前解決とは異なるレイヤー） |
| Microsoft | 実装済み（**未検証**。2026-09、実際の開発者トークンでの疎通確認はまだ）。`lib/ads/microsoft.ts` の `fetchCampaignMetrics`：① `GetCampaignsByAccountId`（Campaign Management Service）でキャンペーンの id・名前・ステータスを同期取得、② `SubmitGenerateReport` → `PollGenerateReport` → ダウンロード（Reporting Service。非同期。ダウンロードファイルはZIP形式のため `jszip` で展開してCSVを読む）で費用・表示回数・クリック等を取得。Campaign Management Service・Reporting Service の SOAP ヘッダーは Customer Management Service と違い `CustomerAccountId`（対象アカウント自身のID）・`CustomerId`（その `ParentCustomerId`）・`Action`（操作名）が必須（ヤフーLINE広告の base account パターンとは異なり、Microsoft はヘッダーの `CustomerAccountId` が対象アカウント自身のIDでよい）。未検証点は `lib/ads/microsoft.ts` 冒頭のコメント参照（SOAPActionのワイヤー形式、ZIPファイルの形式、日付列 `TimePeriod` の実際のフォーマットなど）。本番で最初にエラーが出たら、そのメッセージを見てこのファイルを調整する（ヤフーLINE広告の実装で `x-z-base-account-id` の仕様を実エラーから確定させたのと同じ進め方） |
| Meta / TikTok / X | 未実装 |

`UnifiedCampaignMetric` のような媒体横断の正規化はまだ無く、`app/ad-performance-actions.ts` に媒体ごとの型（`AdPerformance` / `YahooAdPerformance` / `MicrosoftAdPerformance`）のまま並んでいる。

## 未実装（次の段階）

- Meta / TikTok / X の実績取得・分析対象アカウント選択UI
- Microsoft の実績取得・分析対象アカウント選択の本番検証（開発者トークンでの疎通確認・実エラーに応じた調整）
- 媒体ごとにバラバラの実績の型を `UnifiedCampaignMetric` に正規化する部分
- 実績（費用・CV・CPA・ROAS）を「伸びしろ診断」の分析に接続する部分
