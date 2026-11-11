/**
 * fal の Queue API（2026-11-11）。
 * POST https://queue.fal.run/{model}  （Authorization: Key <FAL_KEY>）→ { request_id, status_url, response_url }
 * GET status_url → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }、COMPLETED なら GET response_url で結果。
 * 動画は数分かかるので、送った時点で request の情報を保存し、画面からの問い合わせで続きを進める（Vercel の実行時間に収める）。
 * 外部への送信は FalDeps.fetch を差し替えて検証できる（AGENTS.md：有料 API はスタブで検証する）。
 */

export type FalDeps = { fetch: (url: string, init: RequestInit) => Promise<Response>; key: string | undefined };

export const defaultFalDeps = (): FalDeps => ({ fetch, key: process.env.FAL_KEY });

export function hasFal(): boolean {
  return !!process.env.FAL_KEY;
}

export type FalTicket = { requestId: string; statusUrl: string; responseUrl: string };

function auth(deps: FalDeps) {
  if (!deps.key) throw new Error("fal の API キー（FAL_KEY）が未設定です");
  return { Authorization: `Key ${deps.key}`, "Content-Type": "application/json" };
}

async function errText(res: Response): Promise<string> {
  const t = await res.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d.slice(0, 200);
    if (Array.isArray(d)) return d.map((x) => (x as { msg?: string })?.msg ?? "").filter(Boolean).join("／").slice(0, 200);
  } catch {
    // 本文が JSON でない
  }
  return t.slice(0, 200);
}

/** 依頼を送る（結果は待たない） */
export async function falSubmit(model: string, input: Record<string, unknown>, deps: FalDeps = defaultFalDeps()): Promise<FalTicket> {
  const res = await deps.fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: auth(deps),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    // 403 は鍵の誤り以外に、残高切れ（User is locked）・許可していないモデルでも返る。fal の理由をそのまま出す
    const why = await errText(res);
    if (res.status === 402 || /balance|locked|billing/i.test(why)) throw new Error(`fal の残高が足りません（fal のダッシュボードの Billing で入金・支払い設定を確認してください。fal：${why}）`);
    if (res.status === 401) throw new Error(`fal の API キーが無効です（形式は「キーID:シークレット」の1行。fal：${why}）`);
    throw new Error(`fal に断られました（HTTP 403。キーの権限・使えるモデルの設定を確認してください。fal：${why}）`);
  }
  if (!res.ok) throw new Error(`fal に依頼できませんでした（HTTP ${res.status}：${await errText(res)}）`);
  const j = (await res.json()) as { request_id?: string; status_url?: string; response_url?: string };
  if (!j.request_id || !j.status_url || !j.response_url) throw new Error("fal の受付の返事を読めませんでした");
  return { requestId: j.request_id, statusUrl: j.status_url, responseUrl: j.response_url };
}

export type FalPoll = { state: "waiting" } | { state: "done"; output: unknown } | { state: "error"; message: string };

/** 進み具合を見る。終わっていれば結果も返す */
export async function falPoll(t: FalTicket, deps: FalDeps = defaultFalDeps()): Promise<FalPoll> {
  const s = await deps.fetch(t.statusUrl, { method: "GET", headers: auth(deps), signal: AbortSignal.timeout(20_000) });
  if (!s.ok) {
    if (s.status >= 500) return { state: "waiting" };
    return { state: "error", message: `fal の進み具合を読めませんでした（HTTP ${s.status}）` };
  }
  const st = (await s.json()) as { status?: string };
  if (st.status === "IN_QUEUE" || st.status === "IN_PROGRESS") return { state: "waiting" };
  if (st.status !== "COMPLETED") return { state: "waiting" };
  const r = await deps.fetch(t.responseUrl, { method: "GET", headers: auth(deps), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return { state: "error", message: `作れませんでした（${await errText(r)}）` };
  return { state: "done", output: await r.json() };
}

/** 結果から画像・動画の URL を取り出す */
export function outputUrl(output: unknown, kind: "image" | "video"): string | null {
  const o = (output ?? {}) as { images?: { url?: string }[]; image?: { url?: string }; video?: { url?: string } };
  if (kind === "video") return o.video?.url ?? null;
  return o.images?.[0]?.url ?? o.image?.url ?? null;
}

/** 出来上がったファイルを取ってくる（fal の配信元だけ許可） */
export async function falDownload(url: string, deps: FalDeps = defaultFalDeps()): Promise<{ bytes: Buffer; mime: string }> {
  const host = new URL(url).hostname;
  if (!/(^|\.)(fal\.media|fal\.ai|fal\.run)$/.test(host)) {
    throw new Error(`想定外の配信元です（${host}）`);
  }
  const res = await deps.fetch(url, { method: "GET", signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`出来上がったファイルを取れませんでした（HTTP ${res.status}）`);
  const mime = res.headers.get("content-type") || "application/octet-stream";
  return { bytes: Buffer.from(await res.arrayBuffer()), mime };
}
