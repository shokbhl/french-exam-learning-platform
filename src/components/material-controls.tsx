"use client";

import { useState, useTransition } from "react";
import { Archive, FileAudio, FileText, Globe, Lock, Send, Undo2 } from "lucide-react";
import { setMaterialRelease, setMaterialStatus } from "@/app/admin/materials/actions";
import type { AdminMaterial, AdminMaterialsState } from "@/lib/repositories/admin-materials";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  in_review: "En révision",
  published: "Publié",
  archived: "Archivé",
};

const RIGHTS_LABELS: Record<string, string> = {
  owned: "Propriété du projet",
  licensed: "Licence obtenue",
  public_domain: "Domaine public",
  unknown: "Droits à vérifier",
};

function sizeLabel(bytes: number | null) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

function MaterialRow({ item }: { item: AdminMaterial }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const run = (action: () => Promise<{ ok: boolean; message: string }>) => {
    setFeedback(null);
    startTransition(async () => setFeedback(await action()));
  };

  const Icon = item.mimeType?.startsWith("audio/") ? FileAudio : FileText;
  const rightsUnverified = item.copyrightStatus === "unknown";

  return (
    <article className="material-row">
      <span className="library-icon"><Icon size={20} /></span>
      <div className="library-meta">
        <strong>{item.title}</strong>
        <small>
          {[item.author, item.cefrLevel, item.language?.toUpperCase(), sizeLabel(item.byteSize), RIGHTS_LABELS[item.copyrightStatus] ?? item.copyrightStatus]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {item.fileCount === 0 && <small className="form-error">Aucun fichier associé</small>}
        {feedback && (
          <small role="status" className={feedback.ok ? "form-success" : "form-error"}>{feedback.message}</small>
        )}
      </div>

      <span className={`status-chip status-${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span>

      <span className={item.studentFileAccess ? "release-on" : "release-off"}>
        {item.studentFileAccess ? <><Globe size={14} /> Diffusé</> : <><Lock size={14} /> Non diffusé</>}
      </span>

      <div className="material-actions">
        {item.status === "draft" && (
          <button className="outline" disabled={pending} onClick={() => run(() => setMaterialStatus(item.id, "in_review"))}>
            <Send size={15} /> Envoyer en révision
          </button>
        )}
        {item.status === "in_review" && (
          <button className="primary" disabled={pending} onClick={() => run(() => setMaterialStatus(item.id, "published"))}>
            Publier
          </button>
        )}
        {item.status === "published" && (
          <button className="outline" disabled={pending} onClick={() => run(() => setMaterialStatus(item.id, "draft"))}>
            <Undo2 size={15} /> Dépublier
          </button>
        )}

        {/* Releasing hands over the file itself, which cannot be undone for
            copies already downloaded, so it is confirmed explicitly. */}
        {item.status === "published" && item.fileCount > 0 && (
          item.studentFileAccess ? (
            <button className="outline" disabled={pending} onClick={() => run(() => setMaterialRelease(item.id, false))}>
              Retirer la diffusion
            </button>
          ) : (
            <button
              className="outline"
              disabled={pending || rightsUnverified}
              title={rightsUnverified ? "Établissez les droits avant de diffuser ce fichier" : undefined}
              onClick={() => {
                if (window.confirm("Diffuser ce fichier à tous les membres ? Les copies téléchargées ne pourront pas être rappelées.")) {
                  run(() => setMaterialRelease(item.id, true));
                }
              }}
            >
              Diffuser le fichier
            </button>
          )
        )}

        {item.status !== "archived" && (
          <button className="icon-only" aria-label={`Archiver ${item.title}`} disabled={pending} onClick={() => run(() => setMaterialStatus(item.id, "archived"))}>
            <Archive size={16} />
          </button>
        )}
      </div>
    </article>
  );
}

export function MaterialControls({ state, query }: { state: AdminMaterialsState; query: string }) {
  if (state.status === "unconfigured") {
    return <p className="demo-banner" role="status">Mode démonstration : configurez Supabase pour gérer de vrais matériels.</p>;
  }
  if (state.status === "signed-out") {
    return <p className="demo-banner" role="status">Votre session a expiré.</p>;
  }
  if (state.status === "error") {
    return <p className="form-error" role="alert">{state.message}</p>;
  }

  const needle = query.trim().toLowerCase();
  const items = needle
    ? state.items.filter((i) => i.title.toLowerCase().includes(needle))
    : state.items;

  if (state.items.length === 0) {
    return (
      <div className="empty-state">
        <p><strong>Aucun matériel importé</strong></p>
        <p>Importez un document pour commencer. Rien n’est publié automatiquement.</p>
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="demo-caption">Aucun matériel ne correspond à cette recherche.</p>;
  }

  return <div className="material-list">{items.map((item) => <MaterialRow key={item.id} item={item} />)}</div>;
}
