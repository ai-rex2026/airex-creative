"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { startAnalysis } from "@/app/actions";
import { IconArrowRight, IconGlobe, Logo, SiteFooter } from "./Chrome";

export function Home() {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setErr(null);
    start(async () => {
      try {
        const res = await startAnalysis({ url: url || undefined, text: text || undefined });
        if (res?.error) setErr(res.error);
      } catch (e) {
        // redirect() は例外で飛ぶので、本物のエラーだけ拾う
        const m = e instanceof Error ? e.message : String(e);
        if (!m.includes("NEXT_REDIRECT")) setErr(m);
      }
    });
  }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Logo suffix="Studio" />
          <nav>
            <a href="/lp.html">サービスについて</a>
            <Link href="/contact">お問い合わせ</Link>
            <Link href="/login">ログイン</Link>
          </nav>
        </div>
      </header>

      <main className="grow">
        <div className="hero">
          <div className="wrap">
            <h1>
              URLひとつで、
              <br />
              <span className="gold">訴求軸からバナーとLPまで</span>
            </h1>
            <p className="lead">
              分析したいサイトのURLを入力するだけ。
              <br />
              登録不要ですぐに分析を始められます。
            </p>

            {err && (
              <div className="alert" style={{ maxWidth: 620, margin: "22px auto 0", textAlign: "left" }}>
                {err}
              </div>
            )}

            <div style={{ maxWidth: 620, margin: "30px auto 0" }}>
              <div className="field">
                <IconGlobe />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !pending) submit();
                  }}
                />
                <button className="go" onClick={submit} disabled={pending} aria-label="分析を始める">
                  <IconArrowRight />
                </button>
              </div>
              <textarea
                className="box"
                style={{ marginTop: 12 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="（任意）商品説明・補足。URLが無い場合はここだけでも分析できます"
                rows={2}
              />
            </div>

            <div className="checks">
              <span>✓ {pending ? "分析を積んでいます…" : "登録不要"}</span>
              <span>✓ クレジットカード不要</span>
              <span>✓ すぐに分析を開始</span>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
