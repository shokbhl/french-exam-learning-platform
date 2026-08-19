import { MaterialManager } from "@/components/material-manager";
import { requireStaff } from "@/lib/auth/require-staff";
import { loadAdminMaterials } from "@/lib/repositories/admin-materials";

export default async function MaterialsPage() {
  await requireStaff();
  const materials = await loadAdminMaterials();
  return <MaterialManager materials={materials} />;
}
