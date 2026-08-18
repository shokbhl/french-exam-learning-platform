import {z} from "zod";
export const allowedMaterialTypes=["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain","text/markdown","image/jpeg","image/png","audio/mpeg","audio/wav","audio/mp4"] as const;
export const MAX_MATERIAL_BYTES=25*1024*1024;
export const materialMetadataSchema=z.object({title:z.string().trim().min(3).max(160),author:z.string().trim().max(120).optional(),copyrightStatus:z.enum(["owned","licensed","public_domain","unknown"]),licenseNotes:z.string().trim().max(1000).optional(),language:z.enum(["fr","en","fa","mixed"]),level:z.enum(["A1","A2","B1","B2","C1","C2","unknown"])});
export function validateMaterialFile(file:File){if(file.size===0)return"Le fichier est vide.";if(file.size>MAX_MATERIAL_BYTES)return"Le fichier dépasse la limite de 25 Mo.";if(!allowedMaterialTypes.includes(file.type as typeof allowedMaterialTypes[number]))return"Ce type de fichier n’est pas accepté.";return null}
