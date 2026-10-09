"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createStoreAction, searchStoresForNewAction } from "@/app/meo-actions";
import { INDUSTRY_LABEL, type Industry } from "@/lib/types";
import type { StoreCandidate } from "@/lib/meo-ops/types";

const INDUSTRIES = Object.keys(INDUSTRY_LABEL) as Industry[];

export function NewStoreForm({ initialQuery, initialIndustry }: { initialQuery: string; initialIndustry: Industry }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [industry, setIndustry] = useState<Industry>(initialIndustry);
  const [candidates, setCandidates] = useState<StoreCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy("search");
    setError(null);
    try {
      setCandidates(await searchStoresForNewAction(query));
    } catch (e) {
      setError(e instanceof Error ? e.message : "検索に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function register(placeId: string) {
    setBusy(placeId);
    setError(null);
    try {
      const id = await createStoreAction(placeId, industry);
      router.push(`/stores/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 22 }}>
      <label style={{ fontSize: 13, fontWeight: 700 }}>業種</label>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 8px" }}>
        説明文や返信文を作るときの言い回しと、法令チェックの辞書がこれで切り替わります。
      </p>
      <select value={industry} onChange={(e) => setIndustry(e.target.value as Industry)} style={{ width: "100%", padding: 8 }}>
        {INDUSTRIES.map((k) => (
          <option key={k} value={k}>
            {INDUSTRY_LABEL[k]}
          </option>
        ))}
      </select>

      <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginTop: 18 }}>店舗を検索</label>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && query.trim() && busy === null && search()}
          placeholder="店舗名と住所（例：○○ 渋谷店 東京都渋谷区）"
          style={{ flex: 1, padding: 8 }}
        />
        <button className="btn sm" type="button" disabled={busy !== null || !query.trim()} onClick={search}>
          {busy === "search" ? "検索中…" : "検索"}
        </button>
      </div>

      {error && <p style={{ color: "#B3261E", fontSize: 13, marginTop: 12 }}>{error}</p>}

      {candidates && (
        <div className="rows" style={{ marginTop: 16 }}>
          <div className="rh">{candidates.length ? "登録する店舗を選んでください" : "見つかりませんでした。店舗名や住所を変えて試してください"}</div>
          {candidates.map((c) => (
            <div className="r" key={c.place_id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{c.name}</b>
                <small>{c.address ?? ""}</small>
              </div>
              <button className="btn ghost sm" type="button" disabled={busy !== null} onClick={() => register(c.place_id)}>
                {busy === c.place_id ? "登録中…" : "この店舗を登録"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
