"use client";

import { useEffect } from "react";
import { sectionLabel } from "@/lib/report-sections";

/**
 * チャットで非表示にした章を隠す（2026-11-09）。画面と PDF（印刷）の両方に効く。データは消さない。
 * 章は「見出し（.sec-head の中の h2#sec-xxx）から、次の見出しの手前まで」。
 * 見出しが入れ物（section など）の先頭で、その中にほかの章が無ければ入れ物ごと隠す。
 * タブの切り替えなどで中身が描き直されても隠れたままにするため、DOM の変化を見て付け直す
 */
const ATTR = "data-sec-hidden";

function apply(ids: string[]) {
  document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
  for (const id of ids) {
    const h = document.getElementById(`sec-${id}`);
    if (!h) continue;
    const head = (h.closest(".sec-head") as HTMLElement | null) ?? h;
    const parent = head.parentElement;
    if (!parent) continue;
    const isHead = (el: Element) => el.classList.contains("sec-head") || !!el.querySelector(".sec-head, h2[id^='sec-']");
    // 入れ物の先頭の見出しで、入れ物の中にほかの章が無い → 入れ物ごと
    if (parent.firstElementChild === head && parent.querySelectorAll("h2[id^='sec-']").length === 1 && parent.tagName !== "MAIN" && !parent.classList.contains("report")) {
      parent.setAttribute(ATTR, "");
      continue;
    }
    head.setAttribute(ATTR, "");
    let el = head.nextElementSibling;
    while (el && !isHead(el)) {
      el.setAttribute(ATTR, "");
      el = el.nextElementSibling;
    }
  }
}

export function HiddenSections({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        obs.disconnect();
        apply(list);
        obs.observe(document.body, { childList: true, subtree: true });
      });
    };
    const obs = new MutationObserver(run);
    run();
    return () => {
      cancelAnimationFrame(frame);
      obs.disconnect();
      document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
    };
  }, [key]);

  if (!ids.length) return null;
  return (
    <div className="note no-print" style={{ marginBottom: 12 }}>
      <i className="i">i</i>
      <span>
        非表示にしている章：{ids.map(sectionLabel).join("・")}（画面と PDF 出力から外しています。「レポートについて聞く」で「表示に戻して」と頼むと戻せます）
      </span>
    </div>
  );
}
