import { OpsGate } from "@/components/OpsGate";

/** 運用メニューは有料だけ（無料には案内を出す）。画面の入口をここで一括して止める。Server Action 側にも同じ判定がある */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <OpsGate active="sns">{children}</OpsGate>;
}
