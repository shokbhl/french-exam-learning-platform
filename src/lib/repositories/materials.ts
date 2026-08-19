import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * One entry in the curated library, as a member sees it.
 *
 * `downloadable` reflects `student_file_access`: a published material may be
 * quotable in an exercise without being redistributable, so the catalogue can
 * list something the member cannot open.
 */
export type LibraryItem = {
  id: string;
  title: string;
  author: string | null;
  language: string | null;
  cefrLevel: string | null;
  copyrightStatus: string;
  downloadable: boolean;
  fileId: string | null;
  filename: string | null;
  byteSize: number | null;
  mimeType: string | null;
};

export type LibraryState =
  | { status: "unconfigured" }
  | { status: "signed-out" }
  | { status: "ready"; items: LibraryItem[] }
  | { status: "error"; message: string };

const READ_FAILED = "La bibliothèque n’a pas pu être chargée.";

/**
 * Lists the materials the caller may see.
 *
 * No status filter is applied here. Row level security already restricts the
 * rows to published materials for a member and to everything for staff, so
 * repeating the rule in the query would mean two places to keep in step.
 */
export async function loadLibrary(): Promise<LibraryState> {
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
        "id, title, author, language, cefr_level, copyright_status, student_file_access, source_files(id, original_filename, byte_size, mime_type, version)",
      )
      .order("title");

    if (error) {
      console.error("library read failed", error.message);
      return { status: "error", message: READ_FAILED };
    }

    const items: LibraryItem[] = (data ?? []).map((row) => {
      // Only the newest file version is offered. Older versions stay in the
      // table so that questions citing them keep resolving.
      const files = (row.source_files ?? []) as {
        id: string;
        original_filename: string;
        byte_size: number;
        mime_type: string;
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
        downloadable: Boolean(row.student_file_access && latest),
        fileId: latest?.id ?? null,
        filename: latest?.original_filename ?? null,
        byteSize: latest?.byte_size ?? null,
        mimeType: latest?.mime_type ?? null,
      };
    });

    return { status: "ready", items };
  } catch (error) {
    console.error("library read threw", error);
    return { status: "error", message: READ_FAILED };
  }
}
