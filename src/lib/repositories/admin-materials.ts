import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type MaterialStatus = "draft" | "in_review" | "published" | "archived";

export type AdminMaterial = {
  id: string;
  title: string;
  author: string | null;
  language: string | null;
  cefrLevel: string | null;
  copyrightStatus: string;
  status: MaterialStatus;
  studentFileAccess: boolean;
  publishedAt: string | null;
  releasedAt: string | null;
  fileCount: number;
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
};

export type AdminMaterialsState =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "ready"; items: AdminMaterial[] }
  | { status: "error"; message: string };

/**
 * Lists every material visible to the caller.
 *
 * Staff policies already widen this to drafts and archived items, so no status
 * filter is applied here; the database decides what staff may see.
 */
export async function loadAdminMaterials(): Promise<AdminMaterialsState> {
  if (!isSupabaseConfigured()) return { status: "unconfigured" };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "signed-out" };

    const { data, error } = await supabase
      .from("source_materials")
      .select(
        "id, title, author, language, cefr_level, copyright_status, status, student_file_access, published_at, released_at, source_files(id, original_filename, mime_type, byte_size, version)",
      )
      .order("title");

    if (error) {
      console.error("admin materials read failed", error.message);
      return { status: "error", message: "La liste des matériels n’a pas pu être chargée." };
    }

    const items: AdminMaterial[] = (data ?? []).map((row) => {
      const files = (row.source_files ?? []) as {
        id: string;
        original_filename: string;
        mime_type: string;
        byte_size: number;
        version: number;
      }[];
      const latest = files.slice().sort((a, b) => b.version - a.version)[0] ?? null;
      return {
        id: row.id,
        title: row.title,
        author: row.author,
        language: row.language,
        cefrLevel: row.cefr_level,
        copyrightStatus: row.copyright_status,
        status: row.status as MaterialStatus,
        studentFileAccess: row.student_file_access,
        publishedAt: row.published_at,
        releasedAt: row.released_at,
        fileCount: files.length,
        filename: latest?.original_filename ?? null,
        mimeType: latest?.mime_type ?? null,
        byteSize: latest?.byte_size ?? null,
      };
    });

    return { status: "ready", items };
  } catch (error) {
    console.error("admin materials read threw", error);
    return { status: "error", message: "La liste des matériels n’a pas pu être chargée." };
  }
}
