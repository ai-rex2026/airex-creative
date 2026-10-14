"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAppKeysAction, saveAppKeysAction } from "@/app/sns-ops-actions";
import { disconnectSnsAction } from "@/app/social-actions";
import { Btn, Card, ErrorNote, Icon, Input, Label } from "@/components/meo/ui";
import type { OpsPlatform } from "@/lib/sns-ops/ops-types";

export type ConnView = { connected: boolean; label: string | null; scope: string | null; viaOwnApp: boolean; connectedAt: string | null };

const GUIDE: Record<OpsPlatform, { name: string; idLabel: string; secretLabel: string; where: string; steps: string[]; review: string }> = {
  x: {
    name: "X（開発者コンソール）",
    idLabel: "OAuth 2.0 Client ID",
    secretLabel: "Client Secret",
    where: "https://console.x.com",
    steps: [
      "X の開発者コンソールでアプリ（Project / App）を作り、「User authentication settings」で OAuth 2.0 をオンにします（Type of App は Web App）",
      "App permissions は「Read and write and Direct message」にします（投稿・リポスト・DM のため）",
      "Callback URI に下の「戻り先 URL」を入れます",
      "Keys and tokens の OAuth 2.0 Client ID と Client Secret をここに登録します",
      "X API は従量課金です（投稿 1件 約2円、URL 入りは約30円）。開発者コンソールでクレジットを入れ、上限を設定しておくと安心です",
    ],
    review: "審査は不要です（従量課金のクレジットが要ります）",
  },
  instagram: {
    name: "Meta（Meta for Developers）",
    idLabel: "アプリ ID",
    secretLabel: "app secret",
    where: "https://developers.facebook.com/apps",
    steps: [
      "Meta for Developers でビジネス用のアプリを作り、「Instagram」と「ビジネス向け Facebook ログイン」を追加します",
      "有効な OAuth リダイレクト URI に下の「戻り先 URL」を入れます",
      "ビジネス向け Facebook ログインの「設定」でログイン設定を作り、その ID を「ログイン設定 ID」に入れます（ページの選択画面が出るようになります）",
      "投稿（instagram_content_publish）・コメント（instagram_manage_comments）・DM（instagram_manage_messages）の権限はアプリレビューの承認が要ります。承認までは、アプリの管理者・テスターのアカウントでだけ使えます",
    ],
    review: "投稿・コメント・DM はアプリレビューが要ります",
  },
  tiktok: {
    name: "TikTok for Developers",
    idLabel: "Client key",
    secretLabel: "Client secret",
    where: "https://developers.tiktok.com/apps",
    steps: [
      "TikTok for Developers でアプリを作り、「Login Kit」と「Content Posting API」を追加します",
      "Redirect URI に下の「戻り先 URL」を入れます",
      "スコープ user.info.basic・user.info.stats・video.list・video.upload・video.publish を申請します",
      "監査（audit）を通るまでは、投稿は本人だけが見られる「非公開」になります",
    ],
    review: "公開で投稿するには監査が要ります",
  },
  youtube: {
    name: "Google Cloud（YouTube Data API）",
    idLabel: "OAuth クライアント ID",
    secretLabel: "クライアント シークレット",
    where: "https://console.cloud.google.com/apis/credentials",
    steps: [
      "Google Cloud でプロジェクトを作り、「YouTube Data API v3」を有効にします",
      "OAuth 同意画面を作り、youtube.upload・youtube.force-ssl・youtube.readonly のスコープを足します",
      "認証情報で「OAuth クライアント ID（ウェブ アプリケーション）」を作り、承認済みのリダイレクト URI に下の「戻り先 URL」を入れます",
      "Google の確認（検証）が済むまでは、アップロードした動画は非公開に固定されます。テストユーザーに自分の Google アカウントを入れておきます",
    ],
    review: "公開でアップロードするには Google の確認が要ります",
  },
};

/** 各社のアプリの鍵の登録（会社ごとに自分のアプリを使う口）と、アカウントの連携 */
export function AppKeysCard({
  platform,
  conn,
  redirectUri,
  own,
  sharedAvailable,
  connection,
  error,
  ok,
}: {
  platform: OpsPlatform;
  conn: string;
  redirectUri: string;
  own: { clientId: string; updatedAt: string } | null;
  sharedAvailable: boolean;
  connection: ConnView;
  error: string | null;
  ok: boolean;
}) {
  const router = useRouter();
  const g = GUIDE[platform];
  const [open, setOpen] = useState(!own && !sharedAvailable);
  const [form, setForm] = useState({ clientId: "", clientSecret: "", configId: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const needsReconnect = platform === "x" && connection.connected && !/\bdm\.write\b/.test(connection.scope ?? "") ;
  const canConnect = !!own || sharedAvailable;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "うまくいきませんでした");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#2E2D29]">アカウントの連携</p>
          {connection.connected ? (
            <p className="mt-1 text-xs text-[#2F6B4A]">
              連携中：{connection.label ?? "（名前不明）"}
              {connection.viaOwnApp ? "（自社のアプリ）" : "（共通のアプリ）"}
            </p>
          ) : (
            <p className="mt-1 text-xs text-[#8B877F]">まだ連携していません</p>
          )}
          {needsReconnect && <p className="mt-1 text-xs text-[#8A5340]">画像つき投稿・リポスト・DM を扱うには、連携し直して権限を足してください</p>}
        </div>
        <div className="flex gap-2">
          {connection.connected && (
            <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => confirm("連携を外しますか？") && run("off", () => disconnectSnsAction(conn))}>
              連携を外す
            </Btn>
          )}
          {canConnect ? (
            <a href={`/api/social/${conn}/start?back=/sns/${platform}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#2E2D29] px-3 text-xs font-semibold text-white hover:bg-[#3F3D38]">
              <Icon name="link" className="h-3.5 w-3.5" />
              {connection.connected ? "連携し直す" : "連携する"}
            </a>
          ) : (
            <span className="self-center text-xs text-[#8A5340]">先に下でアプリの鍵を登録してください</span>
          )}
        </div>
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {ok && <p className="mt-3 rounded-xl bg-[#EAF3EE] px-3 py-2 text-xs text-[#2F6B4A]">連携しました</p>}

      <div className="mt-4 border-t border-[#F0EDE8] pt-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="text-sm font-semibold text-[#2E2D29]">
            アプリの鍵（{g.name}）
            <span className="ml-2 text-xs font-normal text-[#8B877F]">{own ? `自社のアプリを登録済み（${own.clientId}）` : sharedAvailable ? "未登録：共通のアプリで連携します" : "未登録"}</span>
          </span>
          <Icon name={open ? "chevronUp" : "chevronDown"} className="h-4 w-4 text-[#8B877F]" />
        </button>
        {open && (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-[#6B6862]">
              投稿・返信・DM・動画のアップロードは、各社の審査を通ったアプリで行う必要があります。会社ごとに自分のアプリを作って鍵を登録すると、そのアプリで連携・投稿します（{g.review}）。
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-[#6B6862]">
              {g.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <a href={g.where} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#3E5C76] underline">
              {g.name}を開く <Icon name="external" className="h-3 w-3" />
            </a>
            <div>
              <Label>戻り先 URL（アプリの設定に入れる）</Label>
              <div className="flex gap-2">
                <Input readOnly value={redirectUri} className="font-mono text-xs" />
                <Btn variant="outline" size="sm" className="h-10 shrink-0" onClick={() => navigator.clipboard.writeText(redirectUri).then(() => setCopied(true))}>
                  {copied ? "コピーしました" : "コピー"}
                </Btn>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{g.idLabel}</Label>
                <Input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} autoComplete="off" />
              </div>
              <div>
                <Label>{g.secretLabel}</Label>
                <Input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} autoComplete="new-password" />
              </div>
              {platform === "instagram" && (
                <div>
                  <Label>ログイン設定 ID（任意）</Label>
                  <Input value={form.configId} onChange={(e) => setForm({ ...form, configId: e.target.value })} autoComplete="off" />
                </div>
              )}
            </div>
            <p className="text-[11px] text-[#A5A198]">シークレットは暗号化して保存し、画面には二度と表示しません。登録・変更したら「連携し直す」を押してください。</p>
            {err && <ErrorNote>{err}</ErrorNote>}
            <div className="flex justify-end gap-2">
              {own && (
                <Btn variant="ghost" size="sm" disabled={busy !== null} onClick={() => confirm("登録した鍵を消しますか？") && run("del", () => deleteAppKeysAction(conn))}>
                  鍵を消す
                </Btn>
              )}
              <Btn
                size="sm"
                disabled={busy !== null || !form.clientId || !form.clientSecret}
                onClick={() =>
                  run("save", async () => {
                    await saveAppKeysAction(conn, form);
                    setForm({ clientId: "", clientSecret: "", configId: "" });
                  })
                }
              >
                {busy === "save" ? <Icon name="loader" /> : <Icon name="save" className="h-3.5 w-3.5" />}
                {own ? "鍵を更新する" : "鍵を登録する"}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
