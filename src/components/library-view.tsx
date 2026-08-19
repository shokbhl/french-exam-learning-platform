"use client";

import { useState } from "react";
import { Download, FileText, Lock } from "lucide-react";
import { createDownloadUrl } from "@/app/library/actions";
import type { LibraryItem, LibraryState } from "@/lib/repositories/materials";

function formatSize(bytes: number | null) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

function LibraryRow({ item }: { item: LibraryItem }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const download = async () => {
    if (!item.fileId) return;
    setPending(true);
    setError("");
    const result = await createDownloadUrl(item.fileId);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // The link expires in two minutes, so it is opened rather than stored.
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const size = formatSize(item.byteSize);
  return (
    <li className="library-row">
      <span className="library-icon"><FileText size={20} /></span>
      <div className="library-meta">
        <strong>{item.title}</strong>
        <small>
          {[item.author, item.cefrLevel, item.language?.toUpperCase(), size]
            .filter(Boolean)
            .join(" · ") || "Document"}
        </small>
        {error && <span role="alert" className="form-error">{error}</span>}
      </div>
      {item.downloadable ? (
        <button className="outline" onClick={download} disabled={pending}>
          <Download size={16} />
          {pending ? "Préparation…" : "Télécharger"}
        </button>
      ) : (
        // A published material is not automatically redistributable: it can be
        // used to build exercises without the file itself being handed over.
        <span className="library-locked" title="Consultable en exercice, non téléchargeable">
          <Lock size={15} /> Consultation encadrée
        </span>
      )}
    </li>
  );
}

export function LibraryView({ state }: { state: LibraryState }) {
  if (state.status === "unconfigured") {
    return <p className="demo-banner" role="status">Mode démonstration : la bibliothèque est vide tant que Supabase n’est pas configuré.</p>;
  }
  if (state.status === "signed-out") {
    return <p className="demo-banner" role="status">Connectez-vous pour consulter la bibliothèque.</p>;
  }
  if (state.status === "error") {
    return <p className="form-error" role="alert">{state.message}</p>;
  }
  if (state.items.length === 0) {
    return (
      <div className="empty-state">
        <p><strong>Aucun document pour le moment</strong></p>
        <p>Les documents publiés par votre équipe pédagogique apparaîtront ici.</p>
      </div>
    );
  }
  return <ul className="library-list">{state.items.map((item) => <LibraryRow key={item.id} item={item} />)}</ul>;
}
