import { createClient } from "@/lib/supabase/server";

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

export async function getTier(): Promise<{ userId: string | null; email: string | null; tier: Tier; features: string[] }> {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return { userId: user?.id ?? null, email: null, tier: "guest", features: [] };
  const { data } = await sb.from("user_profiles").select("tier, features").eq("user_id", user.id).maybeSingle();
  const t = data?.tier;
  const tier: Tier = t === "admin" || t === "paid" || t === "free" ? t : "free";
  return { userId: user.id, email: user.email ?? null, tier, features: (data?.features as string[] | null) ?? [] };
}
