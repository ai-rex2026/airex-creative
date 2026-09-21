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
| Google 広告 | `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET`（ログイン用と共通）`GOOGLE_ADS_DEVELOPER_TOKEN` |
| Yahoo! 広告 | `YAHOO_ADS_CLIENT_ID` `YAHOO_ADS_CLIENT_SECRET` |
| Meta 広告 | `META_APP_ID` `META_APP_SECRET`（Instagram 連携と共通） |
| Microsoft 広告 | `MICROSOFT_CLIENT_ID` `MICROSOFT_CLIENT_SECRET` `MICROSOFT_DEVELOPER_TOKEN` |
| TikTok 広告 | `TIKTOK_APP_ID` `TIKTOK_SECRET` |
| X 広告 | `X_API_KEY` `X_API_SECRET`（コンシューマーキー。**OAuth 1.0a**） |

任意：

- `AD_TOKEN_ENC_KEY` … `openssl rand -base64 32`。設定すると保存するトークンを AES-256-GCM で暗号化する
- `APP_ORIGIN` … リダイレクトURIの origin を固定したいとき（例 `https://xxxx.vercel.app`）。未設定ならアクセスされたホストを使う
- `GOOGLE_ADS_API_VERSION`（既定 `v24`）／`X_ADS_API_BASE`（既定 `https://ads-api.x.com/12`）

## 各媒体の開発者ポータルに登録するリダイレクトURI

`{APP_ORIGIN}/api/ads/{媒体}/callback`

- Google：OAuth クライアントの「承認済みのリダイレクト URI」に追加。スコープ `adwords`
- Yahoo!：アプリのコールバックURLに追加。スコープ `yahooads`
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

## 未実装（次の段階）

- Yahoo! / Microsoft の対象アカウント一覧取得（実績取得と一緒に実装する）
- 各媒体の実績取得と `UnifiedCampaignMetric` への正規化
