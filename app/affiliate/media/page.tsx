import { redirect } from "next/navigation";

// メディア台帳は案件ページのタブに移した。古いリンクは案件一覧へ
export default function MediaLedgerPage() {
  redirect("/affiliate");
}
