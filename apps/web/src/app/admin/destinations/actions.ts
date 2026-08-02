"use server";

import { revalidatePath } from "next/cache";
import {
  addDestinationDraft,
  approveDestination,
  rejectDestination,
  updateDestinationVibeTags,
} from "@mystery-trips/api";
import { getAdminEmail } from "@/lib/admin";

async function requireAdmin() {
  const email = await getAdminEmail();
  if (!email) throw new Error("Unauthorized");
  return email;
}

function vibeTagsFromForm(formData: FormData): string[] {
  return formData
    .getAll("vibeTags")
    .map((v) => String(v).trim())
    .filter(Boolean);
}

export async function approveAction(formData: FormData) {
  const email = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  await approveDestination(id, email, vibeTagsFromForm(formData));
  revalidatePath("/admin/destinations");
  revalidatePath(`/admin/destinations/${id}`);
}

export async function rejectAction(formData: FormData) {
  const email = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  await rejectDestination(id, email);
  revalidatePath("/admin/destinations");
  revalidatePath(`/admin/destinations/${id}`);
}

export async function updateVibesAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  await updateDestinationVibeTags(id, vibeTagsFromForm(formData));
  revalidatePath("/admin/destinations");
  revalidatePath(`/admin/destinations/${id}`);
}

export async function addDestinationAction(formData: FormData) {
  await requireAdmin();
  const city = String(formData.get("city") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const airportCode = String(formData.get("airportCode") ?? "").trim();
  const vibeTags = vibeTagsFromForm(formData);
  const runProfile = formData.get("runProfile") !== "off";

  if (!city || !country || airportCode.length !== 3) {
    throw new Error("city, country, and 3-letter airport code required");
  }

  await addDestinationDraft({
    city,
    country,
    airportCode,
    vibeTags,
    runProfile,
  });
  revalidatePath("/admin/destinations");
}
