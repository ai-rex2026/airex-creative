/**
 * 広告媒体の仕様。**AI の知識に頼らず、ここに書いた事実を渡す。**
 *
 * 媒体仕様は頻繁に変わり、AI の学習データは追いつかない。実際、
 * 「LINE広告は Yahoo!広告に統合されており、Yahoo!タグで計測できる」という
 * 事実を運用者から指摘された（AI は LINE Tag が必要だと出していた）。
 *
 * このファイルは運用者が直接直せるように独立させてある。
 * ここを直せば、タグ診断・施策・広告運用設計のすべてに効く。
 */

export type PlatformFact = {
  id: string;
  name: string;
  /** 運用者から共有された事実。プロンプトにそのまま渡す */
  note: string;
  /** いつ・誰の指摘で入れたか。古くなったときに追える */
  source: string;
};

export const PLATFORM_FACTS: PlatformFact[] = [
  {
    id: "line-yahoo",
    name: "LINE広告",
    note: "LINE広告は Yahoo!広告に統合されている。専用の LINE Tag ではなく Yahoo!タグ（サイトジェネラルタグ）で計測する。LINE Tag の新規設置を勧めない。",
    source: "2026-09-09 運用者（鈴木）指摘",
  },
  {
    id: "affiliate-medical",
    name: "医療・自由診療のアフィリエイト",
    note: "医療・自由診療でもアフィリエイトは実際に運用されており、主力の集客経路になっている事業者がある。『ガイドラインにより原則禁止』と断定しない。医療広告ガイドライン上、体験談や効果を断定する表現をアフィリエイターに書かせない運用管理が要る、という留意点として扱う。",
    source: "2026-09-09 運用者（鈴木）指摘",
  },
];

/** プロンプトに差し込む。AI の思い込みより、ここに書いた事実を優先させる */
export function platformNotes() {
  return PLATFORM_FACTS.map((f) => `- ${f.name}：${f.note}`).join("\n");
}
