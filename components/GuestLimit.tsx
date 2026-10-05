"use client";

import Link from "next/link";

/**
 * 未登録（ゲスト）の分析回数（1端末1回）の判定に使う、ブラウザ側の印。
 * サーバー側のクッキー（app/actions.ts の GUEST_USED_COOKIE）と二重にしておき、
 * どちらかが消されても判定できるようにする。保存できない環境では何もしない
 */
const KEY = "airex_guest_used";

export function guestUsedOnDevice(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markGuestUsed() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // 保存できなくてもクッキー側で判定する
  }
}

/** 回数の上限に達したときに、エラー文の下に出す登録・ログインのボタン */
export function GuestLimitActions() {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
      <Link className="btn" href="/login?mode=signup">無料で会員登録する</Link>
      <Link className="btn ghost" href="/login">ログイン</Link>
    </div>
  );
}
