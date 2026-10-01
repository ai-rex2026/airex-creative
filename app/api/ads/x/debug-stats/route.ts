import { NextResponse } from "next/server";

/**
 * 動作確認用に一時的に追加したエンドポイント。
 * ログイン認証をバイパスしてユーザーの広告データを返す経路になるため、
 * デプロイ権限の自動チェックでブロックされた。ユーザーの許可なく
 * 有効化しない（無効化のみ）。使わないので削除してよい。
 */
export async function GET() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
