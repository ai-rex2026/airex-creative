"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * 口コミ画面（オルコネレックスの /review と同じ動き）。
 * 誰にも Google への道筋を出す。星3以下には「お店に直接伝える」を先に出す。
 * 評価で Google への案内を出し分ける（隠す）ことはしない（Google のポリシー・ステマ規制）。
 */
const safeGoogle = (u: string) => (/^https:\/\/(search\.google\.com|g\.page|www\.google\.[a-z.]+|maps\.app\.goo\.gl)\//.test(u) ? u : "");
const safeEmail = (e: string) => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e) ? e : "");

export function ReviewFlow() {
  const q = useSearchParams();
  const name = (q.get("n") || "当店").slice(0, 80);
  const google = safeGoogle(q.get("g") || "");
  const email = safeEmail(q.get("e") || "");
  const staff = (q.get("s") || "").slice(0, 30);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"stars" | "low" | "thanks">("stars");

  const sendToShop = () => {
    if (email) {
      const body = `【お店へのご意見】${name}${staff ? `（担当: ${staff}）` : ""}\n評価: ${"★".repeat(stars)}${"☆".repeat(5 - stars)}\n\n${text}`;
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(`${name} へのご意見`)}&body=${encodeURIComponent(body)}`;
    }
    setPhase("thanks");
  };
  const openGoogle = () => {
    if (google) window.open(google, "_blank", "noopener");
    setPhase("thanks");
  };
  const starsUi = (
    <div className="my-5 flex justify-center gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" aria-label={`星${n}`} onClick={() => setStars(n)} className={`text-4xl leading-none ${n <= stars ? "text-[#E0A526]" : "text-[#DDD6CB]"}`}>
          ★
        </button>
      ))}
    </div>
  );
  const btn = "block w-full rounded-xl px-4 py-3 text-center text-base font-semibold";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#FBF8F3] px-5 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-sm">
        {phase === "thanks" ? (
          <>
            <h1 className="text-xl font-bold text-[#2B2622]">ありがとうございました</h1>
            <p className="mt-2 text-sm text-[#6B6862]">いただいたご意見は、お店をよくするために使わせていただきます。</p>
            {google && stars >= 4 && (
              <button type="button" className={`${btn} mt-5 bg-[#1A73E8] text-white`} onClick={() => window.open(google, "_blank", "noopener")}>
                Googleに投稿する画面を開く
              </button>
            )}
          </>
        ) : phase === "low" ? (
          <>
            <h1 className="text-xl font-bold text-[#2B2622]">教えていただけますか</h1>
            <p className="mt-2 text-sm text-[#6B6862]">気になった点を、お店に直接お伝えください。</p>
            {starsUi}
            <textarea
              className="h-32 w-full rounded-xl border border-[#E0DBD1] p-3 text-base outline-none focus:border-[#B8865B]"
              placeholder="気になったこと、こうしてほしいこと"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="button" className={`${btn} mt-3 bg-[#2B2622] text-white disabled:opacity-40`} onClick={sendToShop} disabled={!text.trim()}>
              お店に伝える
            </button>
            {google && (
              <a href={google} target="_blank" rel="noreferrer" className="mt-4 block text-sm text-[#8B877F] underline">
                Googleに口コミを書く場合はこちら
              </a>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-[#2B2622]">{name}</h1>
            <p className="mt-2 text-sm text-[#6B6862]">
              {staff ? `担当: ${staff}　` : ""}本日はありがとうございました。率直なご感想をお聞かせください。
            </p>
            {starsUi}
            {stars === 0 && <p className="text-sm text-[#A5A198]">星を選んでください</p>}
            {stars > 0 && stars <= 3 && (
              <>
                {email && (
                  <button type="button" className={`${btn} bg-[#2B2622] text-white`} onClick={() => setPhase("low")}>
                    お店に直接伝える
                  </button>
                )}
                {google && (
                  <a href={google} target="_blank" rel="noreferrer" className={email ? "mt-4 block text-sm text-[#8B877F] underline" : `${btn} bg-[#1A73E8] text-white`} onClick={() => setPhase("thanks")}>
                    Googleに口コミを書く
                  </a>
                )}
              </>
            )}
            {stars >= 4 && (
              <>
                {google ? (
                  <button type="button" className={`${btn} bg-[#1A73E8] text-white`} onClick={openGoogle}>
                    Googleに口コミを書く
                  </button>
                ) : (
                  <p className="text-sm text-[#B5523B]">口コミのリンクが設定されていません</p>
                )}
                {email && (
                  <button type="button" className="mt-4 text-sm text-[#8B877F] underline" onClick={() => setPhase("low")}>
                    お店に直接伝える
                  </button>
                )}
              </>
            )}
            <p className="mt-6 text-[11px] text-[#A5A198]">投稿は任意です。内容によって特典が変わることはありません。</p>
          </>
        )}
      </div>
    </main>
  );
}
