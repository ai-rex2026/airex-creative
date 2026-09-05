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
}: {
  title: string;
  intro: string;
  headings: string[];
  sourceUrl: string;
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
