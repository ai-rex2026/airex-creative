import { SimpleHeader, SiteFooter } from "@/components/Chrome";

/**
 * 規約類は「見出しの並び」だけ本番から写し、本文は入れていない。
 * 法務文書を推測で書くと事故になるため、正文は本番の該当ページから持ってくる。
 */
export function LegalPage({
  title,
  intro,
  headings,
  sourceUrl,
  operator = true,
}: {
  title: string;
  intro: string;
  headings: string[];
  sourceUrl: string;
  /** 事業者情報。条文と違い事実なので、こちらは載せる */
  operator?: boolean;
}) {
  return (
    <>
      <SimpleHeader />
      <div className="page">
        <h1>{title}</h1>
        <p className="intro">{intro}</p>

        {headings.map((h) => (
          <section key={h}>
            <h2>{h}</h2>
            <p style={{ color: "var(--faint)", fontSize: 13 }}>【本文未収録】</p>
          </section>
        ))}

        {operator && (
          <section>
            <h2>事業者情報</h2>
            <table className="spec" style={{ marginTop: 12 }}>
              <tbody>
                <tr><th>事業者</th><td>株式会社アドレクス</td></tr>
                <tr><th>代表者</th><td>代表取締役社長　田代 逸哉人</td></tr>
                <tr><th>所在地</th><td>〒105-0002　東京都港区愛宕2丁目5-1　愛宕グリーンヒルズMORIタワー34階</td></tr>
                <tr><th>担当部署</th><td>AIサポート窓口</td></tr>
                <tr><th>連絡先</th><td><a href="mailto:info@airex-ad.ai">info@airex-ad.ai</a></td></tr>
              </tbody>
            </table>
          </section>
        )}

        <p className="note">
          <i className="i">i</i>
          <span>
            条文の並びは本番ページから写しています。<b style={{ fontWeight: 600 }}>本文は法務文書なので推測では書きません。</b>
            正文は{" "}
            <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: "var(--gold-text)" }}>
              本番ページ
            </a>{" "}
            から差し込んでください。
          </span>
        </p>
      </div>
      <SiteFooter />
    </>
  );
}
