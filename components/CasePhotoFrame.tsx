"use client";

import { CASE_FIELDS, CASE_RULES, LIMITED_RELEASE } from "@/lib/case-photo";

/**
 * 症例写真の掲載枠。
 *
 * 写真は生成しない。実在しない治療結果を載せると医療法第6条の5の虚偽広告になる。
 * ここで出すのは「要件を満たした状態の枠」で、写真は院の実症例を差し込んでもらう。
 * 併記文は写真に直接付けないと要件を満たさないので、枠の中に置いている。
 */
export function CasePhotoFrame() {
  return (
    <div className="cpf">
      <div className="cpf-h">
        <b>症例写真の掲載枠</b>
        <span>医療広告ガイドラインの併記要件を組み込んだ型です</span>
      </div>

      <div className="cpf-shots">
        {["術前", "術後"].map((t) => (
          <div className="cpf-slot" key={t}>
            <span className="cpf-tag">{t}</span>
            <span className="cpf-ph">院の実症例写真を差し込みます</span>
            <small>撮影場所・角度・照明・メイク・髪型を術前術後でそろえる／加工・修正はしない</small>
          </div>
        ))}
      </div>

      <dl className="cpf-fields">
        {CASE_FIELDS.map((f) => (
          <div key={f.key}>
            <dt>{f.label}</dt>
            <dd>{f.hint}</dd>
          </div>
        ))}
      </dl>

      <div className="cpf-note">
        <b>この枠を使える媒体の条件（限定解除）</b>
        <ol>
          {LIMITED_RELEASE.map((x, i) => <li key={i}>{x}</li>)}
        </ol>
        <b>撮影・掲載の遵守事項</b>
        <ul>
          {CASE_RULES.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
        <p>
          写真は院の実症例に限ります。生成画像や他院の写真、加工した写真を使うと
          医療法第6条の5の虚偽広告にあたります。
        </p>
      </div>
    </div>
  );
}
