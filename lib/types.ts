/** 業種。禁止表現の辞書と、コピーの言い回しをこれで切り替える */
export type Industry = "beauty" | "medical" | "supplement" | "finance" | "general";

export const INDUSTRY_LABEL: Record<Industry, string> = {
  beauty: "美容・エステ",
  medical: "医療・クリニック",
  supplement: "健康食品・サプリ",
  finance: "金融・投資",
  general: "一般（規制業種でない）",
};

/** 診断結果。ここから先の生成はすべてこれを入力にする */
export type Diagnosis = {
  url: string;
  title: string;
  /** 何を売っているか（1文） */
  product: string;
  /** 誰に売るか */
  audience: string;
  industry: Industry;
  /** 強み・独自性 */
  strengths: string[];
  /** 買わない理由（ここを潰すコピーが効く） */
  objections: string[];
  /** 訴求軸。バナー1本＝訴求軸1本で作る */
  angles: Angle[];
  /** ブランドの見え方。全生成物が参照する土台（ロードマップ #08 Brand Style の最小版） */
  brand: BrandProfile;
};

export type Angle = {
  id: string;
  /** 訴求軸の名前（例：価格の透明性） */
  name: string;
  /** なぜ効くと考えたか */
  why: string;
};

export type BrandProfile = {
  name: string;
  kana: string;
  tone: string;
  /** 16進。バナー・LPの基調色 */
  accent: string;
  /** 使ってはいけない言い回し（クライアント固有） */
  ngWords: string[];
};

/** 法令ガードレールの判定（ロードマップ #10。生成と同時に必ず通す） */
export type GuardVerdict = {
  level: "red" | "yellow" | "green";
  /** 引っかかった箇所 */
  hits: { text: string; reason: string; law: string; suggestion: string }[];
};

export type BannerCopy = {
  angleId: string;
  /** 見出し2行。2行目が色替え */
  headline: [string, string];
  subhead?: string;
  ribbonTop?: string;
  ribbonBottom?: string;
  body: string;
  cta: string;
  /** 勝ち筋スコア 0-100（ロードマップ #02 の最小版） */
  score?: number;
  scoreReason?: string;
  guard?: GuardVerdict;
};
