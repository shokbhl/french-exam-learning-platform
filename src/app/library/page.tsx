import { LibraryView } from "@/components/library-view";
import { loadLibrary } from "@/lib/repositories/materials";

export const metadata = { title: "Bibliothèque" };

export default async function LibraryPage() {
  const state = await loadLibrary();
  return (
    <main className="page">
      <div className="page-intro">
        <p className="eyebrow">BIBLIOTHÈQUE</p>
        <h1>Vos documents d’étude</h1>
        <p>
          Les documents publiés par votre équipe pédagogique. Certains sont
          consultables en exercice sans être téléchargeables, selon leur licence.
        </p>
      </div>
      <LibraryView state={state} />
    </main>
  );
}
