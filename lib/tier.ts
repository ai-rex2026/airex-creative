import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isGuest } from "@/lib/tier-core";

/**
 * ユーザーのランク（2026-11-18）。guest（未登録・匿名）< free < paid < admin。
 * 保存は public.user_profiles.tier（本人からは読み取りのみ。付け替えはサービス側＝管理者の操作）。行が無い登録ユーザーは free。
 * ページと Server Action は、ここの getTier() だけでランクを判定する（画面の出し分けだけに頼らず、Action の中でも必ず確認する）
 */
export type Tier = "guest" | "free" | "paid" | "admin";

const ORDER: Tier[] = ["guest", "free", "paid", "admin"];

/** tier が min 以上か（例：atLeast(tier, "paid") は有料と管理者） */
export function atLeast(tier: Tier, min: Tier): boolean {
  return ORDER.indexOf(tier) >= ORDER.indexOf(min);
}

/** 運用メニューごとの許可のキー。有料の中での出し分けは user_profiles.features に入れる（設計は後で決める。いまは判定に使っていない） */
export const MENU_KEYS = ["meo", "seo", "aio", "lpo", "ads", "affiliate", "sns"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];

export type TierInfo = { userId: string | null; email: string | null; tier: Tier; features: string[] };

/** 1回のリクエストの中では結果を使い回す（Shell・ページ・Action から何度呼んでもDBは1回） */
export const getTier = cache(async (): Promise<TierInfo> => {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (isGuest(user)) return { userId: null, email: null, tier: "guest", features: [] };
  const { data } = await sb.from("user_profiles").select("tier, features").eq("user_id", user.id).maybeSingle();
  const t = data?.tier;
  const tier: Tier = t === "admin" || t === "paid" || t === "free" ? t : "free";
  return { userId: user.id, email: user.email ?? null, tier, features: (data?.features as string[] | null) ?? [] };
});

/**
 * 運用メニュー（店舗・SEO・AIO・LPO・広告・アフィリエイト・SNS）は、いまは有料（と管理者）だけ（2026-11-18）。
 * 無料は全体レポートの作成だけ。ゲストは各ページの登録案内に任せるので、ここで止めるのは「登録済みの無料」だけ。
 * メニューごとに分ける設計は後で決める（user_profiles.features）。そのときは、ここの判定だけ差し替える
 */
export const OPS_LOCKED_MESSAGE = "この機能は有料プランでご利用いただけます。ご希望の場合はお問い合わせください";

export async function opsBlocked(): Promise<boolean> {
  const { tier } = await getTier();
  return tier === "free";
}
