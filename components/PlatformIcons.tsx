/**
 * 広告・SNS媒体の小さいアイコン。
 *
 * 公式ロゴの画素単位の再現はしない（商標）。識別できる程度の、シンプルな
 * モノクロ／デュオトーンの自作グリフにとどめる。components/Chrome.tsx の
 * 手書きSVGアイコン（IconArrowRight 等）と同じ作り方に揃えている。
 *
 * 同じ媒体でも、呼び出し元ごとに表記ゆれがある
 * （例: "Google 広告" / "Google検索広告" / "Google P-MAX" / "Googleディスプレイ広告"）。
 * ここでは文字列の部分一致で正規化し、どの呼び出し元からも同じアイコンが出るようにする。
 */

export type PlatformKey =
  | "google"
  | "yahoo"
  | "meta"
  | "facebook"
  | "instagram"
  | "x"
  | "tiktok"
  | "youtube"
  | "line"
  | "microsoft"
  | "unknown";

/**
 * 媒体名の表記ゆれを、アイコンの種類に正規化する。
 * 上から順に判定し、最初に一致したものを使う（"Meta（Facebook / Instagram）" のような
 * 複合ラベルは、先に Meta に当たるので meta アイコンになる）。
 */
export function normalizePlatform(raw: string | null | undefined): PlatformKey {
  const s = (raw ?? "").trim();
  if (!s) return "unknown";

  if (/google/i.test(s)) return "google";
  if (/yahoo/i.test(s)) return "yahoo";
  if (/meta/i.test(s)) return "meta";
  if (/facebook/i.test(s)) return "facebook";
  // "X" は1文字なので、前後が英字の単語の一部（"MAX" 等）でないときだけ拾う
  if (/x（twitter）/i.test(s) || /twitter/i.test(s) || /(?:^|[^a-z])x(?:$|[^a-z])/i.test(s)) return "x";
  if (/tiktok|ティックトック/i.test(s)) return "tiktok";
  if (/youtube/i.test(s)) return "youtube";
  if (/line/i.test(s)) return "line";
  if (/instagram|インスタ/i.test(s)) return "instagram";
  if (/microsoft/i.test(s)) return "microsoft";
  return "unknown";
}

type IconProps = { size?: number };

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: `0 0 ${size}px`, display: "inline-block", verticalAlign: "middle" }}
    >
      {children}
    </svg>
  );
}

/** Google: 丸いGの切れ目 */
function GoogleIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M12 12h8" />
    </Svg>
  );
}

/** Yahoo: 「y!」 */
function YahooIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M5 5l4 6v6" />
      <path d="M13 5l-3.5 6" />
      <path d="M18 9v6" />
      <circle cx="18" cy="18" r="0.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Meta: 連なる輪（無限大っぽいマーク） */
function MetaIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="12" r="5" />
      <circle cx="16" cy="12" r="5" />
    </Svg>
  );
}

/** Facebook: 小文字「f」のバッジ */
function FacebookIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M14 21v-7h2.5l.5-3H14V9a1.5 1.5 0 0 1 1.5-1.5H17V5h-2A4 4 0 0 0 11 9v2H9v3h2v7" />
    </Svg>
  );
}

/** Instagram: カメラのアウトライン */
function InstagramIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** X: 交差する2本線 */
function XIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </Svg>
  );
}

/** TikTok: 音符マーク */
function TikTokIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M13 4v10.5a3.5 3.5 0 1 1-3-3.46" />
      <path d="M13 4c.5 2.3 2.2 4 4.5 4.3" />
    </Svg>
  );
}

/** YouTube: 角丸四角の中に再生三角 */
function YouTubeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.5 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** LINE: 吹き出し */
function LineIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M21 11.5c0-4.1-4-7.5-9-7.5S3 7.4 3 11.5c0 3.7 3.2 6.8 7.4 7.4-.3 1.1-.3 2-.3 2s2.7-1.1 4.6-2.7c3.6-.7 6.3-3.6 6.3-7.2z" />
    </Svg>
  );
}

/** Microsoft: 4分割の窓 */
function MicrosoftIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="8" height="8" />
      <rect x="13" y="3" width="8" height="8" />
      <rect x="3" y="13" width="8" height="8" />
      <rect x="13" y="13" width="8" height="8" />
    </Svg>
  );
}

/** 未知の媒体: ただの点（崩さず置き換えるためのプレースホルダー） */
function UnknownIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Svg>
  );
}

const ICONS: Record<PlatformKey, (p: IconProps) => React.ReactElement> = {
  google: GoogleIcon,
  yahoo: YahooIcon,
  meta: MetaIcon,
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  x: XIcon,
  tiktok: TikTokIcon,
  youtube: YouTubeIcon,
  line: LineIcon,
  microsoft: MicrosoftIcon,
  unknown: UnknownIcon,
};

/**
 * 媒体名の文字列（表記ゆれOK）を渡すと、対応するアイコンを出す。
 * 未知の文字列が来てもクラッシュせず、プレースホルダーのドットを出す。
 */
export function PlatformIcon({ platform, size = 16 }: { platform: string | null | undefined; size?: number }) {
  const key = normalizePlatform(platform);
  const Icon = ICONS[key] ?? UnknownIcon;
  return <Icon size={size} />;
}
