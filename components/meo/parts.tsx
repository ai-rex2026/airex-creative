"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { draftPostAction, draftReplyAction } from "@/app/meo-actions";
import {
  calcCompleteness,
  dismissPromptForToday,
  formatDailyAxisDate,
  formatDate,
  hasDailyTrend,
  isPromptDismissedToday,
  localDateKey,
  meoPath,
  pendingItems,
  readDoneTodoIds,
  summarizeDailyTrend,
  totalTodoMinutes,
  writeDoneTodoIds,
} from "@/lib/meo-ops/logic";
import type {
  MeoDailyPoint,
  MeoMetric,
  MeoPost,
  MeoPostInput,
  MeoPostStatus,
  MeoReview,
  MeoSuggestion,
  MeoTodo,
  ProfileChecklistItem,
  ReviewReplyStatus,
} from "@/lib/meo-ops/types";
import type { GuardHit } from "@/lib/types";
import { Btn, cn, Dialog, GuardNotes, Icon, Input, Label, Select, Textarea } from "./ui";

// ── 指標タイル ─────────────────────────────────
export function MetricTile({ metric, comparisonLabel = "前月比" }: { metric: MeoMetric; comparisonLabel?: string }) {
  const { changeRate, higherIsBetter } = metric;
  const isPositive = changeRate != null && (higherIsBetter ? changeRate > 0 : changeRate < 0);
  const isFlat = changeRate == null || changeRate === 0;
  const trend = isFlat ? "minus" : changeRate > 0 ? "arrowUpRight" : "arrowDownRight";
  return (
    <div className="rounded-2xl border border-[#E8E5E0] bg-white p-4">
      <p className="text-xs font-semibold text-[#8B877F]">{metric.label}</p>
      {/* 未取得は「-」。0 と書くと、露出が無かったのか集計前なのか読み手が判断できない */}
      <p className="disp mt-1 text-2xl font-black text-[#2E2D29]">
        {metric.value == null ? (
          <span className="text-[#A5A198]">-</span>
        ) : (
          <>
            {metric.value.toLocaleString()}
            <span className="ml-1 text-xs font-normal text-[#A5A198]">{metric.unit}</span>
          </>
        )}
      </p>
      {changeRate != null && (
        <p
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            isFlat ? "bg-[#F4F3F0] text-[#6B6862]" : isPositive ? "bg-[#EDF3FD] text-[#1D4ED8]" : "bg-[#F8F1ED] text-[#A8705A]"
          )}
        >
          <Icon name={trend} className="h-3 w-3" />
          {comparisonLabel} {changeRate > 0 ? "+" : ""}
          {changeRate.toFixed(1)}%
        </p>
      )}
    </div>
  );
}

// ── 星・状態バッジ ───────────────────────────────
export function StarRating({ rating }: { rating: number }) {
  return (
    <span role="img" aria-label={`星${rating}`} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon key={n} name="star" filled={n <= rating} className={cn("h-3.5 w-3.5", n <= rating ? "text-[#B98A5E]" : "text-[#DDD9D2]")} />
      ))}
    </span>
  );
}

const REVIEW_STATUS: Record<ReviewReplyStatus, { label: string; className: string }> = {
  unreplied: { label: "未返信", className: "bg-[#F8F1ED] text-[#A8705A]" },
  pending: { label: "送信中", className: "bg-[#F4F3F0] text-[#57544E]" },
  replied: { label: "返信済み", className: "bg-[#F4F3F0] text-[#26251F]" },
  needsUpdate: { label: "再返信推奨", className: "bg-[#F8F1ED] text-[#8A5340]" },
  failed: { label: "送信失敗", className: "bg-[#F8F1ED] text-[#A8705A]" },
};

function ReviewStatusBadge({ status }: { status: ReviewReplyStatus }) {
  const s = REVIEW_STATUS[status];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s.className)}>{s.label}</span>;
}

// ── クチコミ ──────────────────────────────────
const REPLY_MAX_LENGTH = 4000;

/**
 * クチコミ1件の表示と返信。AI返信は「生成 → 編集 → 送信」の3ステップを1画面で完結させる。
 */
export function ReviewCard({
  review,
  analysisId,
  onReply,
  compact = false,
  canSend = true,
}: {
  review: MeoReview;
  analysisId: string;
  onReply?: (reviewId: string, reply: string) => Promise<void>;
  compact?: boolean;
  canSend?: boolean;
}) {
  const [isComposing, setIsComposing] = useState(false);
  const [draft, setDraft] = useState(review.reply ?? "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [hits, setHits] = useState<GuardHit[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  // 返信が更新されたら下書きも追従させる。編集中は利用者の入力を優先する
  useEffect(() => {
    if (!isComposing) setDraft(review.reply ?? "");
  }, [review.reply, isComposing]);

  const generate = async () => {
    setIsGenerating(true);
    setGenError(null);
    try {
      const r = await draftReplyAction(analysisId, review.id);
      setDraft(r.reply);
      setHits(r.guardHits);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "返信文を作れませんでした");
    } finally {
      setIsGenerating(false);
    }
  };

  const cancel = () => {
    setDraft(review.reply ?? "");
    setHits([]);
    setIsComposing(false);
  };

  // 送信できたときだけ閉じる。失敗しても閉じると書いた返信がそのまま消える
  const send = async () => {
    if (!draft.trim() || !onReply) return;
    setIsSending(true);
    try {
      await onReply(review.id, draft.trim());
      setIsComposing(false);
    } catch {
      // エラー表示は呼び出し側が行う
    } finally {
      setIsSending(false);
    }
  };

  return (
    <article className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StarRating rating={review.rating} />
        <span className="text-sm font-semibold text-[#2E2D29]">{review.authorName}</span>
        <ReviewStatusBadge status={review.status} />
        {review.aioScore != null && (
          <span title="クチコミ内容のAIO（AI検索最適化）スコア" className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[11px] font-semibold text-[#57544E]">
            AIO {review.aioScore}/5
          </span>
        )}
        <span className="ml-auto text-xs text-[#A5A198]">{formatDate(review.createdAt)}</span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[#3F3D38]">{review.text}</p>

      {review.status === "failed" && review.errorMessage && (
        <p className="mt-3 rounded-xl border border-[#ECD9CE] bg-[#F8F1ED] px-3 py-2 text-xs text-[#A8705A]">Googleへの送信に失敗しました: {review.errorMessage}</p>
      )}

      {review.reply && !isComposing && (
        <div className="mt-4 rounded-xl border border-[#F0EEEA] bg-[#FAF9F7] p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#8B877F]">
            <Icon name="reply" className="h-3.5 w-3.5" />
            店舗からの返信
            {review.repliedAt && <span className="font-normal">（{formatDate(review.repliedAt)}）</span>}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#3F3D38]">{review.reply}</p>
        </div>
      )}

      {compact ? null : isComposing ? (
        <div className="mt-4 space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={REPLY_MAX_LENGTH}
            placeholder="返信文を入力するか、AIで下書きを作成してください"
            className="resize-y"
          />
          <GuardNotes hits={hits} />
          {genError && <p className="text-xs text-[#A8705A]">{genError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Btn size="sm" variant="outline" onClick={generate} disabled={isGenerating || isSending}>
              <Icon name={isGenerating ? "loader" : "sparkles"} />
              {isGenerating ? "生成中..." : draft ? "AIで書き直す" : "AIで返信文を作る"}
            </Btn>
            <Btn size="sm" onClick={send} disabled={!draft.trim() || isSending || !canSend} title={canSend ? undefined : "GBPの店舗と連携すると送信できます"}>
              <Icon name="send" />
              返信を送信
            </Btn>
            <Btn size="sm" variant="ghost" onClick={cancel}>
              <Icon name="x" />
              キャンセル
            </Btn>
            <span className="ml-auto text-xs text-[#A5A198]">
              {draft.length} / {REPLY_MAX_LENGTH}文字
            </span>
          </div>
          <p className="text-xs text-[#A5A198]">
            {canSend
              ? "AI返信のトーンや使いたい言葉は「設定」タブで調整できます。"
              : "Googleビジネスプロフィールの店舗と連携すると、ここから返信を送信できます（「設定」タブ）。"}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <Btn size="sm" variant={review.status === "replied" ? "outline" : "primary"} onClick={() => setIsComposing(true)}>
            <Icon name="reply" />
            {review.status === "replied" ? "返信を編集" : "返信する"}
          </Btn>
        </div>
      )}
    </article>
  );
}

// ── 投稿 ─────────────────────────────────────
const POST_STATUS: Record<MeoPostStatus, { label: string; className: string }> = {
  draft: { label: "下書き", className: "bg-[#F4F3F0] text-[#57544E]" },
  scheduled: { label: "予約中", className: "bg-[#F8F1ED] text-[#8A5340]" },
  published: { label: "投稿済み", className: "bg-[#F4F3F0] text-[#26251F]" },
};

export function PostCard({ post }: { post: MeoPost }) {
  const status = POST_STATUS[post.status];
  const dateLabel =
    post.status === "scheduled" && post.scheduledAt
      ? `${formatDate(post.scheduledAt)} に配信予定`
      : post.status === "published" && post.publishedAt
        ? `${formatDate(post.publishedAt)} に投稿`
        : "日時未設定";
  return (
    <article className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", status.className)}>{status.label}</span>
        {post.aiGenerated && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[11px] font-semibold text-[#8A5340]">
            <Icon name="sparkles" className="h-3 w-3" />
            AI生成
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#A5A198]">
          <Icon name="calendar" className="h-3.5 w-3.5" />
          {dateLabel}
        </span>
      </div>
      <h3 className="mt-3 font-semibold text-[#2E2D29]">{post.title}</h3>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#6B6862]">{post.body}</p>
      {post.errorMessage && <p className="mt-2 text-xs text-[#A8705A]">Googleへの配信に失敗しました: {post.errorMessage}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#8B877F]">
        <span className="inline-flex items-center gap-1">
          <Icon name="image" className="h-3.5 w-3.5" />
          {post.imageUrl ? "画像あり" : "画像なし"}
        </span>
        {post.actionButton && (
          <span className="inline-flex items-center gap-1">
            <Icon name="external" className="h-3.5 w-3.5" />
            ボタン: {post.actionButton.label}
          </span>
        )}
      </div>
    </article>
  );
}

const TITLE_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 1500;
const THEMES = [
  { value: "campaign", label: "キャンペーン告知" },
  { value: "newItem", label: "新商品・新メニュー" },
  { value: "notice", label: "営業時間・お知らせ" },
  { value: "seasonal", label: "季節の話題" },
];
const ACTION_BUTTONS = [
  { value: "none", label: "なし" },
  { value: "reserve", label: "予約する" },
  { value: "detail", label: "詳細を見る" },
  { value: "call", label: "電話する" },
];

/** GBP最新情報の投稿作成。AI生成 → 編集 → 予約 の順で1画面に収める */
export function PostComposer({
  analysisId,
  storeName,
  websiteUrl,
  onCreate,
  onClose,
}: {
  analysisId: string;
  storeName: string;
  websiteUrl: string | null;
  onCreate: (post: MeoPostInput) => Promise<void>;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState("campaign");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [actionButton, setActionButton] = useState("none");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hits, setHits] = useState<GuardHit[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  const generate = async () => {
    setIsGenerating(true);
    setGenError(null);
    try {
      const r = await draftPostAction(analysisId, theme, storeName);
      setTitle(r.title);
      setBody(r.body);
      setHits(r.hits);
      setAiGenerated(true);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "投稿文を作れませんでした");
    } finally {
      setIsGenerating(false);
    }
  };

  const canSubmit = title.trim() !== "" && body.trim() !== "";

  const submit = async (status: "draft" | "scheduled") => {
    setIsSaving(true);
    try {
      const label = ACTION_BUTTONS.find((b) => b.value === actionButton)?.label ?? "";
      await onCreate({
        title: title.trim(),
        body: body.trim(),
        status,
        scheduledAt: status === "scheduled" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        imageUrl: null,
        actionButton: actionButton === "none" ? null : { label, url: websiteUrl ?? "" },
        aiGenerated,
      });
      onClose();
    } catch {
      // エラー表示は呼び出し側。入力を保持したまま開いておく
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#E0DBD1] bg-[#FAF9F7] p-5">
      <div className="flex items-center justify-between">
        <h3 className="disp text-sm font-bold text-[#2E2D29]">新しい投稿を作る</h3>
        <button type="button" onClick={onClose} aria-label="投稿の作成を閉じる" className="rounded-full p-1 text-[#8B877F] transition-colors hover:bg-[#EFEDE8]">
          <Icon name="x" />
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label htmlFor="post-theme">テーマ</Label>
            <Select id="post-theme" value={theme} onChange={setTheme} options={THEMES} />
          </div>
          <Btn variant="outline" onClick={generate} disabled={isGenerating}>
            <Icon name={isGenerating ? "loader" : "sparkles"} />
            {isGenerating ? "生成中..." : "AIで文章を作る"}
          </Btn>
        </div>
        {genError && <p className="text-xs text-[#A8705A]">{genError}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="post-title">タイトル</Label>
          <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX_LENGTH} placeholder="例: 8月の限定キャンペーンのお知らせ" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="post-body">本文</Label>
          <Textarea
            id="post-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={BODY_MAX_LENGTH}
            rows={5}
            placeholder={`投稿する内容を入力してください（${BODY_MAX_LENGTH}文字まで）`}
            className="resize-y"
          />
          <p className="text-xs text-[#A5A198]">
            {body.length} / {BODY_MAX_LENGTH}文字
          </p>
        </div>

        <GuardNotes hits={hits} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="post-schedule">配信日時</Label>
            <Input id="post-schedule" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="post-action">アクションボタン</Label>
            <Select id="post-action" value={actionButton} onChange={setActionButton} options={ACTION_BUTTONS} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#E8E5E0] pt-4">
          <Btn onClick={() => submit("scheduled")} disabled={!canSubmit || !scheduledAt || isSaving}>
            <Icon name="calendar" />
            予約する
          </Btn>
          <Btn variant="outline" onClick={() => submit("draft")} disabled={!canSubmit || isSaving}>
            下書き保存
          </Btn>
          <p className="ml-auto text-xs text-[#A5A198]">GBP連携が完了すると、予約した日時に自動で投稿されます。</p>
        </div>
      </div>
    </div>
  );
}

// ── 改善提案 ──────────────────────────────────
const PRIORITY_CARD: Record<MeoSuggestion["priority"], { label: string; className: string }> = {
  high: { label: "優先度 高", className: "bg-[#F8F1ED] text-[#A8705A]" },
  medium: { label: "優先度 中", className: "bg-[#F8F1ED] text-[#8A5340]" },
  low: { label: "優先度 低", className: "bg-[#F4F3F0] text-[#57544E]" },
};

export function SuggestionCard({ suggestion, analysisId }: { suggestion: MeoSuggestion; analysisId: string }) {
  const p = PRIORITY_CARD[suggestion.priority];
  return (
    <div className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F4F3F0]">
          <Icon name="sparkles" className="h-4 w-4 text-[#8A5340]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-[#2E2D29]">{suggestion.title}</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", p.className)}>{p.label}</span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-[#6B6862]">{suggestion.body}</p>
          {suggestion.actionPath && suggestion.actionLabel && (
            <Link href={meoPath(analysisId, suggestion.actionPath)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#2E2D29] hover:text-[#8A5340]">
              {suggestion.actionLabel}
              <Icon name="arrowRight" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const PRIORITY_BUBBLE: Record<MeoSuggestion["priority"], { label: string; className: string }> = {
  high: { label: "いますぐ", className: "bg-[#F8F1ED] text-[#A8705A]" },
  medium: { label: "今週中に", className: "bg-[#F8F1ED] text-[#8A5340]" },
  low: { label: "余裕があれば", className: "bg-[#F4F3F0] text-[#57544E]" },
};

function Robot() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2E2D29]">
      <Icon name="bot" className="h-5 w-5 text-white" />
    </div>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-[#E8E5E0] bg-white p-4">
      <span aria-hidden className="absolute -left-[7px] top-3 h-3 w-3 rotate-45 border-b border-l border-[#E8E5E0] bg-white" />
      {children}
    </div>
  );
}

/** AIからの改善提案を、話しかけてくる吹き出しとして見せる（毎日開く画面で素通りされないように） */
export function AiAdviceBubble({ suggestions, analysisId }: { suggestions: MeoSuggestion[]; analysisId: string }) {
  if (suggestions.length === 0) {
    return (
      <div className="flex items-start gap-3">
        <Robot />
        <Bubble>
          <p className="text-sm leading-relaxed text-[#6B6862]">
            まだ提案できるほどデータが集まってないんだ。クチコミや投稿がたまってきたら、次にやるといいことをここで話すね。
          </p>
        </Bubble>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {suggestions.map((s) => {
        const p = PRIORITY_BUBBLE[s.priority];
        return (
          <div key={s.id} className="flex items-start gap-3">
            <Robot />
            <Bubble>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-[#2E2D29]">{s.title}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", p.className)}>{p.label}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-[#6B6862]">{s.body}</p>
              {s.actionPath && s.actionLabel && (
                <Link href={meoPath(analysisId, s.actionPath)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#2E2D29] hover:text-[#8A5340]">
                  {s.actionLabel}
                  <Icon name="arrowRight" />
                </Link>
              )}
            </Bubble>
          </div>
        );
      })}
    </div>
  );
}

// ── 日次の推移 ─────────────────────────────────
const SERIES = "#8A5340";
const GRID = "#EDEAE5";
const CHART_H = 88;

/** 1系列のスパークライン。欠測日（null）は飛ばして線をつなぐ（バッチ落ちを0と誤読させない） */
function Spark({ points, pick, kind, pad }: { points: MeoDailyPoint[]; pick: (p: MeoDailyPoint) => number | null; kind: "line" | "bar"; pad: number }) {
  const W = 600;
  const vals = points.map(pick);
  const nums = vals.filter((v): v is number => v != null);
  if (!nums.length) return <EmptyPlot />;
  const min = kind === "bar" ? 0 : Math.min(...nums) - pad;
  const max = Math.max(...nums) + (kind === "bar" ? 0 : pad);
  const span = max - min || 1;
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 8) + 4);
  const y = (v: number) => CHART_H - 4 - ((v - min) / span) * (CHART_H - 8);
  const grid = [0.25, 0.5, 0.75].map((f) => CHART_H * f);
  return (
    <svg viewBox={`0 0 ${W} ${CHART_H}`} preserveAspectRatio="none" className="h-full w-full" role="img">
      {grid.map((g) => (
        <line key={g} x1={0} x2={W} y1={g} y2={g} stroke={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {kind === "line" ? (
        <polyline
          fill="none"
          stroke={SERIES}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          points={vals
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(" ")}
        />
      ) : (
        vals.map((v, i) =>
          v == null ? null : (
            <rect key={i} x={x(i) - 4} width={8} y={y(v)} height={Math.max(CHART_H - 4 - y(v), v > 0 ? 2 : 0)} fill={SERIES} rx={2}>
              <title>{`${formatDailyAxisDate(points[i].date)}: ${v}件`}</title>
            </rect>
          )
        )
      )}
    </svg>
  );
}

function EmptyPlot({ note }: { note?: string }) {
  return (
    <div
      className="flex h-full items-center justify-center rounded-lg"
      style={{ backgroundImage: `repeating-linear-gradient(to bottom, ${GRID} 0, ${GRID} 1px, transparent 1px, transparent 18px)` }}
    >
      {note && <p className="rounded bg-white px-2 text-xs text-[#A5A198]">{note}</p>}
    </div>
  );
}

function DeltaBadge({ delta, format }: { delta: number | null; format: (v: number) => string }) {
  if (delta == null) return null;
  // 丸めた結果が 0 なら「増えた」と見せない
  const rounded = Number(format(delta));
  const flat = !Number.isFinite(rounded) || rounded === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        flat ? "bg-[#F4F3F0] text-[#6B6862]" : rounded > 0 ? "bg-[#EDF3FD] text-[#1D4ED8]" : "bg-[#F8F1ED] text-[#A8705A]"
      )}
    >
      <Icon name={flat ? "minus" : rounded > 0 ? "arrowUpRight" : "arrowDownRight"} className="h-3 w-3" />
      {rounded > 0 ? "+" : ""}
      {format(rounded)}
    </span>
  );
}

function TrendRow({ label, value, delta, formatDelta, children }: { label: string; value: string; delta?: number | null; formatDelta?: (v: number) => string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-[#F0EDE8] pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <p className="text-xs font-semibold text-[#8B877F]">{label}</p>
        <p className="disp text-lg font-black text-[#2E2D29]">{value}</p>
        {formatDelta && <DeltaBadge delta={delta ?? null} format={formatDelta} />}
      </div>
      <div style={{ height: CHART_H }}>{children}</div>
    </div>
  );
}

/**
 * 日次の推移。単位もスケールも違う3指標は2軸で重ねず、指標ごとのスパークラインに分ける。
 */
export function DailyTrendCard({ points }: { points: MeoDailyPoint[] }) {
  const has = hasDailyTrend(points);
  const { latest, meoScoreDelta, averageRatingDelta, newReviewsTotal } = summarizeDailyTrend(points);
  const range = has ? `${formatDailyAxisDate(points[0].date)} 〜 ${formatDailyAxisDate(points[points.length - 1].date)}` : "記録の蓄積中";
  return (
    <div className="space-y-4 rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-[#2E2D29]">日次の推移</p>
        <p className="text-xs text-[#A5A198]">{range}</p>
      </div>
      <TrendRow label="MEOスコア" value={latest?.meoScore != null ? String(latest.meoScore) : "—"} delta={meoScoreDelta} formatDelta={(v) => v.toFixed(0)}>
        {has ? <Spark points={points} pick={(p) => p.meoScore} kind="line" pad={5} /> : <EmptyPlot note="まだ記録がありません" />}
      </TrendRow>
      <TrendRow label="クチコミ増加" value={`${newReviewsTotal} 件`}>
        {has ? <Spark points={points} pick={(p) => p.newReviewCount} kind="bar" pad={0} /> : <EmptyPlot />}
      </TrendRow>
      <TrendRow
        label="平均評価"
        value={latest?.averageRating != null ? latest.averageRating.toFixed(1) : "—"}
        delta={averageRatingDelta}
        formatDelta={(v) => v.toFixed(1)}
      >
        {has ? <Spark points={points} pick={(p) => p.averageRating} kind="line" pad={0.2} /> : <EmptyPlot />}
      </TrendRow>
      {!has && <p className="text-xs leading-relaxed text-[#A5A198]">1日1回自動で記録し、2日分たまるとグラフになります。</p>}
    </div>
  );
}

// ── 今日やること ───────────────────────────────
const TODO_ICON: Record<string, string> = { unreplied: "message", needsUpdate: "message", drafts: "megaphone", profile: "store" };

/** 起動時ダイアログと消し込みリスト。同じ消し込み状態を見るので、状態はここ1か所で持つ */
export function TodayTodos({ todos, analysisId }: { todos: MeoTodo[]; analysisId: string }) {
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [promptOpen, setPromptOpenState] = useState(false);
  const hasTodos = todos.length > 0;

  // localStorage はSSRに無いので、マウント後に復元する（初回描画をサーバーと揃える）
  useEffect(() => {
    const today = localDateKey();
    setDoneIds(readDoneTodoIds(analysisId, today));
    if (!hasTodos || isPromptDismissedToday(analysisId, today)) return;
    setPromptOpenState(true);
  }, [analysisId, hasTodos]);

  const setPromptOpen = (open: boolean) => {
    setPromptOpenState(open);
    // 閉じ方によらず今日は出し切ったものとして扱う
    if (!open) dismissPromptForToday(analysisId, localDateKey());
  };

  const toggle = (id: string) =>
    setDoneIds((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      writeDoneTodoIds(analysisId, localDateKey(), next);
      return next;
    });

  const open = todos.filter((t) => !doneIds.includes(t.id));

  return (
    <>
      <TodoList todos={todos} analysisId={analysisId} doneIds={doneIds} onToggle={toggle} />
      {open.length > 0 && (
        <Dialog
          open={promptOpen}
          onOpenChange={setPromptOpen}
          className="max-w-md"
          title="今日やること"
          description={
            <span className="flex items-center gap-1.5">
              未対応 {open.reduce((t, x) => t + x.count, 0)}件
              <Icon name="clock" className="h-3.5 w-3.5 text-[#A5A198]" />
              所要 約{totalTodoMinutes(open)}分
            </span>
          }
        >
          <ol className="space-y-2">
            {open.map((t, i) => (
              <li key={t.id}>
                <Link
                  href={meoPath(analysisId, t.path)}
                  onClick={() => setPromptOpen(false)}
                  className="group flex items-center gap-3 rounded-xl border border-[#E8E5E0] bg-white px-3.5 py-3 transition-colors hover:border-[#C9A84C] hover:bg-[#FDFBF4]"
                >
                  <span className="disp flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C9A84C] text-xs font-black text-[#2E2D29]">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#2E2D29]">
                      {t.label}
                      <span className="ml-1.5 tabular-nums text-[#8B877F]">{t.count}件</span>
                    </span>
                    <span className="block text-xs text-[#8B877F]">→ {t.actionLabel}</span>
                  </span>
                  <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-[#A5A198]" />
                </Link>
              </li>
            ))}
          </ol>
          <div className="mt-5 space-y-2">
            <Link
              href={meoPath(analysisId, open[0].path)}
              onClick={() => setPromptOpen(false)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-[#C9A84C] text-sm font-semibold text-[#2E2D29] hover:bg-[#B8973F]"
            >
              最初のタスクを始める
              <Icon name="arrowRight" />
            </Link>
            <button type="button" onClick={() => setPromptOpen(false)} className="w-full py-1 text-center text-xs font-medium text-[#8B877F] hover:text-[#2E2D29]">
              あとで（今日は表示しない）
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function TodoList({ todos, analysisId, doneIds, onToggle }: { todos: MeoTodo[]; analysisId: string; doneIds: string[]; onToggle: (id: string) => void }) {
  if (todos.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[#E0DBD1] bg-[#F4F3F0] p-5">
        <Icon name="checkCircle" className="h-5 w-5 shrink-0 text-[#26251F]" />
        <p className="text-sm font-medium text-[#26251F]">対応が必要な項目はありません。今日の運用は完了しています。</p>
      </div>
    );
  }
  const doneCount = todos.filter((t) => doneIds.includes(t.id)).length;
  const remaining = todos.length - doneCount;
  const progress = Math.round((doneCount / todos.length) * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EDEAE4]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="今日やることの消化率">
          <div className="h-full rounded-full bg-[#C9A84C] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="shrink-0 text-xs font-semibold tabular-nums text-[#6B6862]">{remaining === 0 ? "今日の分は片付きました" : `残り ${remaining}件 / ${todos.length}件`}</p>
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {todos.map((t) => {
          const done = doneIds.includes(t.id);
          const urgent = t.tone === "urgent" && !done;
          return (
            <li key={t.id}>
              <div
                className={cn(
                  "group flex items-center gap-2.5 rounded-xl border pr-3 transition-colors",
                  done ? "border-[#EDEAE4] bg-[#FAF9F7]" : urgent ? "border-[#ECD9CE] bg-[#F8F1ED] hover:border-[#DFC3B4]" : "border-[#E8E5E0] bg-white hover:border-[#D8D4CC]"
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggle(t.id)}
                  aria-pressed={done}
                  aria-label={`「${t.label}」を${done ? "未完了に戻す" : "完了にする"}`}
                  className="flex shrink-0 items-center py-3 pl-3.5"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                      done ? "border-[#C9A84C] bg-[#C9A84C] text-[#2E2D29]" : "border-[#CFCAC0] text-transparent hover:border-[#C9A84C]"
                    )}
                  >
                    <Icon name="check" className="h-3 w-3" strokeWidth={3} />
                  </span>
                </button>
                <Link href={meoPath(analysisId, t.path)} className="flex min-w-0 flex-1 items-center gap-3 py-3">
                  <Icon name={TODO_ICON[t.id] ?? "message"} className={cn("h-4 w-4 shrink-0", done ? "text-[#C6C2BA]" : urgent ? "text-[#A8705A]" : "text-[#A5A198]")} />
                  <span className={cn("min-w-0 truncate text-sm font-semibold", done ? "text-[#A5A198] line-through" : "text-[#2E2D29]")}>{t.label}</span>
                  <span
                    className={cn(
                      "disp shrink-0 rounded-full px-2 py-0.5 text-xs font-black tabular-nums",
                      done ? "bg-[#F1EFEB] text-[#A5A198]" : urgent ? "bg-[#F1DED4] text-[#8A4A2E]" : "bg-[#F4F3F0] text-[#2E2D29]"
                    )}
                  >
                    {t.count}
                  </span>
                  <span className={cn("ml-auto hidden shrink-0 items-center gap-1 text-sm font-semibold sm:inline-flex", done ? "text-[#B4B0A8]" : "text-[#57544E]")}>
                    {t.actionLabel}
                    <Icon name="arrowRight" />
                  </span>
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── プロフィール完成度 ───────────────────────────
export function ProfileCompletenessCard({ checklist, analysisId }: { checklist: ProfileChecklistItem[]; analysisId: string }) {
  const score = calcCompleteness(checklist);
  const pending = pendingItems(checklist);
  return (
    <div className="rounded-2xl border border-[#E8E5E0] bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[#2E2D29]">プロフィール完成度</p>
        <p className="disp text-2xl font-black text-[#2E2D29]">
          {score}
          <span className="ml-0.5 text-xs font-normal text-[#A5A198]">%</span>
        </p>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#F0EEEA]">
        <div className="h-full rounded-full bg-[#2E2D29] transition-[width] duration-500" style={{ width: `${score}%` }} />
      </div>
      <ul className="mt-4 space-y-2.5">
        {checklist.slice(0, 4).map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm">
            <Icon name={item.done ? "checkCircle" : "circle"} className={cn("mt-0.5 h-4 w-4 shrink-0", item.done ? "text-[#26251F]" : "text-[#C9C4BA]")} />
            <span className={item.done ? "text-[#8B877F] line-through" : "text-[#2E2D29]"}>{item.label}</span>
          </li>
        ))}
      </ul>
      {pending.length > 0 && (
        <p className="mt-3 text-xs text-[#8B877F]">
          残り{pending.length}項目。「{pending[0].label}」を埋めると完成度が{pending[0].weight}ポイント上がります。
        </p>
      )}
      <Link href={meoPath(analysisId, "/profile")} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#2E2D29] hover:text-[#8A5340]">
        プロフィールを編集する
        <Icon name="arrowRight" />
      </Link>
    </div>
  );
}

// ── タグ入力 ──────────────────────────────────
export function TagInput({ id, values, placeholder, onChange }: { id: string; values: string[]; placeholder?: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2">
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 日本語入力の変換確定Enterでは追加しない
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F3F0] py-1 pl-3 pr-1.5 text-sm text-[#3F3D38]">
                {v}
                <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`${v}を削除`} className="rounded-full p-0.5 text-[#8B877F] hover:bg-[#E0DBD1] hover:text-[#2E2D29]">
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FilterPills<K extends string>({ items, value, counts, onChange }: { items: { key: K; label: string }[]; value: K; counts: Record<K, number>; onChange: (k: K) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          onClick={() => onChange(it.key)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
            value === it.key ? "border-[#2E2D29] bg-[#2E2D29] text-white" : "border-[#E8E5E0] bg-white text-[#57544E] hover:border-[#D8D4CC]"
          )}
        >
          {it.label}
          <span className="ml-1.5 text-xs opacity-70">{counts[it.key]}</span>
        </button>
      ))}
    </div>
  );
}
