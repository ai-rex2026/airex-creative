/**
 * 「ゲスト（未登録・匿名）」の定義を1か所に置く（2026-11-18）。サーバー専用の依存を持たないので、どこからでも読める。
 * ゲスト＝ログインしていない、または匿名ユーザー。ページ・Server Action・API は、ここの isGuest() で判定する
 * （free／paid／admin の区別が要る所は lib/tier.ts の getTier()）
 * 戻り値は型ガード：false の側では user が非 null と分かる（匿名ユーザーを含む true の側では user を使わないこと）
 */
export function isGuest<T extends { is_anonymous?: boolean }>(user: T | null | undefined): user is null | undefined {
  return !user || !!user.is_anonymous;
}
