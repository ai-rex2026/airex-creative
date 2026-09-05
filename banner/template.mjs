// 日本語バナーの文字は生成モデルに描かせず、HTML/CSS で組む。
// 生成AIに任せるのは「素材（背景・キャラ）」と「コピー」だけ、という分担。
export function renderHtml(spec) {
  const { size, theme, logo, headline, subhead, ribbon, body, cta, art } = spec;
  const s = { w: size.w, h: size.h };
  const u = s.w / 1080; // 1080px 基準のスケール
  const px = (n) => `${(n * u).toFixed(2)}px`;
  const artBottom = spec.artBottom ?? 340;
  const artWidth = spec.artWidth ?? 560;

  const headlineHtml = headline
    .map(
      (line) =>
        `<div class="hl-line ${line.accent ? 'accent' : ''}" style="font-size:${px(line.size ?? 150)}">${line.text}</div>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><style>
  @page { margin: 0 }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${s.w}px; height:${s.h}px; }
  body {
    font-family: "Hiragino Sans", "ヒラギノ角ゴシック", sans-serif;
    background:${theme.bg};
    overflow:hidden;
  }
  .stage { position:relative; width:${s.w}px; height:${s.h}px; overflow:hidden;
    background:
      radial-gradient(120% 70% at 50% 8%, ${theme.glow} 0%, rgba(0,0,0,0) 60%),
      linear-gradient(180deg, #2a2a2a 0%, #0b0b0b 45%, #000 100%);
  }
  /* 右上の斜めストライプ */
  .stripes { position:absolute; top:${px(-70)}; right:${px(-70)}; width:${px(360)}; height:${px(300)};
    transform:rotate(-38deg); display:flex; gap:${px(14)}; align-items:flex-start; }
  .stripes i { display:block; width:${px(16)}; height:100%; background:${theme.accent}; opacity:.85; }
  .stripes i:nth-child(2){ height:72%; opacity:.55 }
  .stripes i:nth-child(3){ height:88%; background:#fff; opacity:.28 }
  .stripes i:nth-child(4){ height:56%; opacity:.35 }

  .logo { position:absolute; top:${px(46)}; left:${px(46)}; display:flex; align-items:center; gap:${px(16)} }
  .logo img { width:${px(92)}; height:${px(92)}; object-fit:contain; mix-blend-mode:screen }
  .logo .wm { line-height:1 }
  .logo .wm b { display:block; font-weight:900; color:#fff; font-size:${px(50)}; letter-spacing:${px(1)} }
  .logo .wm span { display:block; color:${theme.accent}; font-size:${px(20)}; font-weight:700; letter-spacing:${px(3)}; margin-top:${px(6)} }

  .art { position:absolute; right:${px(-70)}; bottom:${px(artBottom)}; width:${px(artWidth)}; z-index:1;
    mix-blend-mode:screen; opacity:.9 }
  .art img { width:100%; display:block }

  .copy { position:absolute; top:${px(200)}; left:${px(52)}; right:${px(52)}; z-index:4 }
  .hl-line { font-weight:900; color:#fff; line-height:1.02; letter-spacing:${px(-4)};
    text-shadow: 0 ${px(10)} ${px(22)} rgba(0,0,0,.65);
    -webkit-text-stroke: ${px(2)} rgba(0,0,0,.35); }
  .hl-line.accent { color:${theme.accent};
    background:linear-gradient(180deg, #ffe9a3 0%, ${theme.accent} 48%, #b8860b 100%);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .subhead { margin-top:${px(14)}; font-weight:900; color:#fff; font-size:${px(64)}; letter-spacing:${px(-1)};
    text-shadow:0 ${px(6)} ${px(16)} rgba(0,0,0,.6) }

  .ribbon { position:relative; display:inline-block; margin-top:${px(38)}; padding:${px(18)} ${px(38)} ${px(22)};
    background:#fff; transform:skewX(-6deg); box-shadow:0 ${px(10)} ${px(24)} rgba(0,0,0,.45);
    clip-path: polygon(0 6%, 100% 0, 99% 100%, 1% 94%); }
  .ribbon > div { transform:skewX(6deg) }
  .ribbon .r1 { font-weight:900; color:#111; font-size:${px(46)}; letter-spacing:${px(-1)} }
  .ribbon .r2 { font-weight:900; color:#c30d1e; font-size:${px(64)}; letter-spacing:${px(-2)}; margin-top:${px(4)};
    border-bottom:${px(8)} solid #c30d1e; display:inline-block; padding-bottom:${px(2)} }

  .footer { position:absolute; left:0; right:0; bottom:0; z-index:6; background:#000;
    padding:${px(44)} ${px(52)} ${px(52)}; }
  .footer p { color:#fff; font-weight:700; font-size:${px(38)}; line-height:1.5; letter-spacing:${px(-0.5)} }
  .cta { margin:${px(34)} auto 0; width:fit-content; background:#fff; border-radius:${px(999)};
    padding:${px(24)} ${px(64)}; display:flex; align-items:center; gap:${px(18)};
    box-shadow:0 ${px(8)} ${px(20)} rgba(255,255,255,.18) }
  .cta svg { width:${px(44)}; height:${px(44)} }
  .cta b { font-weight:900; color:#111; font-size:${px(46)}; letter-spacing:${px(-1)} }
</style></head>
<body><div class="stage">
  <div class="stripes"><i></i><i></i><i></i><i></i></div>
  ${art ? `<div class="art"><img src="${art}"></div>` : ''}
  <div class="logo">
    ${logo.mark ? `<img src="${logo.mark}">` : ''}
    <div class="wm"><b>${logo.name}</b><span>${logo.sub}</span></div>
  </div>
  <div class="copy">
    ${headlineHtml}
    ${subhead ? `<div class="subhead">${subhead}</div>` : ''}
    ${ribbon ? `<div class="ribbon"><div class="r1">${ribbon.top}</div><div class="r2">${ribbon.bottom}</div></div>` : ''}
  </div>
  <div class="footer">
    <p>${body}</p>
    <div class="cta">
      <svg viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="2.4" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/></svg>
      <b>${cta}</b>
    </div>
  </div>
</div></body></html>`;
}
