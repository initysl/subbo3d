import SimLab from "@/components/debug/SimLab";

export const metadata = {
  title: "Feel lab — Subbo3D",
};

export default function SimLabPage() {
  return (
    <main className="min-h-dvh bg-neutral-900">
      <SimLab />
    </main>
  );
}
