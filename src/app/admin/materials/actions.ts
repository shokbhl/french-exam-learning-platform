"use server";
import {createHash,randomUUID} from "node:crypto"; import {isSupabaseConfigured} from "@/lib/env"; import {createClient} from "@/lib/supabase/server"; import {materialMetadataSchema,validateMaterialFile} from "@/lib/validation/material";
export type UploadState={status:"idle"|"success"|"error";message:string};
export async function uploadMaterial(_previous:UploadState,formData:FormData):Promise<UploadState>{if(!isSupabaseConfigured())return{status:"error",message:"Mode démonstration : configurez Supabase pour téléverser des fichiers privés."};const file=formData.get("file");if(!(file instanceof File))return{status:"error",message:"Sélectionnez un fichier."};const fileError=validateMaterialFile(file);if(fileError)return{status:"error",message:fileError};const metadata=materialMetadataSchema.safeParse({title:formData.get("title"),author:formData.get("author")||undefined,copyrightStatus:formData.get("copyrightStatus"),licenseNotes:formData.get("licenseNotes")||undefined,language:formData.get("language"),level:formData.get("level")});if(!metadata.success)return{status:"error",message:metadata.error.issues[0]?.message??"Métadonnées invalides."};const supabase=await createClient();const{data:{user}}=await supabase.auth.getUser();if(!user)return{status:"error",message:"Votre session a expiré."};const{data:roles}=await supabase.from("user_roles").select("role").eq("user_id",user.id);if(!roles?.some(r=>r.role==="admin"||r.role==="editor"))return{status:"error",message:"Accès réservé aux éditeurs et administrateurs."};const bytes=new Uint8Array(await file.arrayBuffer());const digest=createHash("sha256").update(bytes).digest("hex");const sourceId=randomUUID();const extension=file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g,"")||"bin";const path=`${sourceId}/v1-${digest.slice(0,12)}.${extension}`;const{error:storageError}=await supabase.storage.from("materials").upload(path,bytes,{contentType:file.type,upsert:false});if(storageError)return{status:"error",message:"Le stockage privé a refusé le fichier."};const{error:sourceError}=await supabase.from("source_materials").insert({id:sourceId,title:metadata.data.title,author:metadata.data.author,copyright_status:metadata.data.copyrightStatus,license_notes:metadata.data.licenseNotes,language:metadata.data.language,cefr_level:metadata.data.level,created_by:user.id});if(sourceError){await supabase.storage.from("materials").remove([path]);return{status:"error",message:"Impossible d’enregistrer les métadonnées."}}const{error:fileDbError}=await supabase.from("source_files").insert({source_id:sourceId,version:1,original_filename:file.name,storage_path:path,mime_type:file.type,byte_size:file.size,sha256:digest});if(fileDbError)return{status:"error",message:"Le fichier est stocké mais son indexation doit être réparée par un administrateur."};return{status:"success",message:"Matériel stocké en privé. Un brouillon a été créé pour révision."}}

// ---------------------------------------------------------------------------
// Publication controls
// ---------------------------------------------------------------------------
// Publishing and releasing are deliberately separate actions taken by a person.
// Nothing in the ingestion pipeline may set either of them: extracted or
// generated content reaches learners only after someone approves it here.

import { revalidatePath } from "next/cache";
import { z } from "zod";

export type ControlState = { ok: boolean; message: string };

const statusSchema = z.object({
  materialId: z.string().uuid(),
  status: z.enum(["draft", "in_review", "published", "archived"]),
});

const releaseSchema = z.object({
  materialId: z.string().uuid(),
  release: z.boolean(),
});

type StaffGuard =
  | { ok: false; message: string }
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> };

/** Confirms the caller is an editor or admin, returning the client to use. */
async function requireStaffClient(): Promise<StaffGuard> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Mode démonstration : configurez Supabase pour gérer les matériels." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Votre session a expiré." };

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  if (!roles?.some((r) => r.role === "admin" || r.role === "editor")) {
    return { ok: false, message: "Accès réservé aux éditeurs et administrateurs." };
  }
  return { ok: true, supabase };
}

export async function setMaterialStatus(materialId: string, status: string): Promise<ControlState> {
  const parsed = statusSchema.safeParse({ materialId, status });
  if (!parsed.success) return { ok: false, message: "Requête invalide." };

  const guard = await requireStaffClient();
  if (!guard.ok) return { ok: false, message: guard.message };

  const { error } = await guard.supabase
    .from("source_materials")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.materialId);

  if (error) {
    console.error("status change failed", error.message);
    return { ok: false, message: "Le changement d’état a échoué." };
  }

  revalidatePath("/admin/materials");
  revalidatePath("/library");
  return { ok: true, message: "État mis à jour." };
}

export async function setMaterialRelease(materialId: string, release: boolean): Promise<ControlState> {
  const parsed = releaseSchema.safeParse({ materialId, release });
  if (!parsed.success) return { ok: false, message: "Requête invalide." };

  const guard = await requireStaffClient();
  if (!guard.ok) return { ok: false, message: guard.message };

  const { error } = await guard.supabase
    .from("source_materials")
    .update({ student_file_access: parsed.data.release })
    .eq("id", parsed.data.materialId);

  if (error) {
    // The database refuses to release a material whose rights are still
    // unverified, which is the most likely reason to land here.
    if (error.message.includes("source_materials_release_requires_rights")) {
      return {
        ok: false,
        message: "Impossible de diffuser un document dont les droits ne sont pas établis.",
      };
    }
    console.error("release change failed", error.message);
    return { ok: false, message: "La diffusion n’a pas pu être modifiée." };
  }

  revalidatePath("/admin/materials");
  revalidatePath("/library");
  return {
    ok: true,
    message: parsed.data.release
      ? "Document diffusé aux membres."
      : "Diffusion retirée. Les copies déjà téléchargées ne sont pas rappelées.",
  };
}
