import { askJson } from "./anthropic";
import { checkGuard } from "./guardrail";
import type { BannerCopy, Diagnosis, GuardVerdict } from "./types";

export type LpDraft = { html: string; guard: GuardVerdict };

/**
 * 広告のリンク先LPを1枚で作る。バナーと同じ訴求軸から起こすので、
 * 「広告で言ったこと」と「着地で言っていること」がずれない。
 */
export async function generateLp(d: Diagnosis, copy: BannerCopy): Promise<LpDraft> {
  const res = await askJson<{ sections: { h: string; body: string }[]; hero: string; sub: string; cta: string; faq: { q: string; a: string }[] }>(
    `あなたはLPの構成作家です。広告のリンク先として成立する1枚もののLP原稿を書きます。
根拠のない数値・最上級・効果の断定は使わないこと。sections は4〜6本。`,
    `商材: ${d.product}
ターゲット: ${d.audience}
強み: ${d.strengths.join(" / ")}
買わない理由: ${d.objections.join(" / ")}
広告で使う見出し: ${copy.headline.join("")}

出力: {"hero":"","sub":"","cta":"","sections":[{"h":"","body":""}],"faq":[{"q":"","a":""}]}`,
    { maxTokens: 4000 }
  );

  const accent = d.brand.accent || "#f0b429";
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.brand.name)}｜${esc(res.hero)}</title>
<meta name="description" content="${esc(res.sub)}">
<style>
:root{--accent:${accent}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;color:#111;line-height:1.7}
.hero{background:linear-gradient(180deg,#1a1a1a,#000);color:#fff;padding:72px 24px;text-align:center}
.hero h1{font-size:clamp(28px,6vw,52px);font-weight:900;line-height:1.25}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero p{margin-top:20px;opacity:.85;font-size:clamp(14px,3.4vw,18px)}
.cta{display:inline-block;margin-top:32px;background:var(--accent);color:#111;font-weight:900;
  padding:18px 44px;border-radius:999px;text-decoration:none;font-size:18px}
main{max-width:760px;margin:0 auto;padding:56px 24px}
section{margin-bottom:44px}
section h2{font-size:22px;font-weight:900;border-left:6px solid var(--accent);padding-left:12px}
section p{margin-top:12px;color:#333}
.faq dt{font-weight:800;margin-top:20px}
.faq dd{margin-top:6px;color:#444}
footer{background:#111;color:#fff;text-align:center;padding:48px 24px}
</style></head>
<body>
<header class="hero">
  <h1>${esc(copy.headline[0])}<br><em>${esc(copy.headline[1])}</em></h1>
  <p>${esc(res.sub)}</p>
  <a class="cta" href="#form">${esc(res.cta || copy.cta)}</a>
</header>
<main>
${res.sections.map((s) => `  <section><h2>${esc(s.h)}</h2><p>${esc(s.body)}</p></section>`).join("\n")}
  <section class="faq"><h2>よくある質問</h2><dl>
${res.faq.map((f) => `    <dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join("\n")}
  </dl></section>
</main>
<footer id="form">
  <p>${esc(res.hero)}</p>
  <a class="cta" href="#">${esc(res.cta || copy.cta)}</a>
</footer>
</body></html>`;

  const guard = await checkGuard(
    [res.hero, res.sub, res.cta, ...res.sections.map((s) => `${s.h} ${s.body}`)],
    d.industry
  );
  return { html, guard };
}

function esc(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
