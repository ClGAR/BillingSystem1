import { supabase } from "../lib/supabaseClient";
import type { SaleEntry } from "../types/sales";

export type SalesDashboardRawRow = Record<string, unknown>;

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

async function resolveSalesUserId(username: string): Promise<string | null> {
  const trimmed = username.trim();
  if (!trimmed) return null;

  try {
    const { data, error } = await supabase
      .from("sales_users")
      .select("id")
      .eq("username", trimmed)
      .maybeSingle();

    if (error) return null;
    return (data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

export async function saveSalesEntry(entry: SaleEntry): Promise<void> {
  const primaryAmount = Math.max(0, toNumber(entry.totalSales) - toNumber(entry.amount2));
  const secondaryAmount = Math.max(0, toNumber(entry.amount2));
  const salesUserId = await resolveSalesUserId(entry.username);

  const salesEntryInsert: Record<string, unknown> = {
    event: toText(entry.event),
    entry_date: toText(entry.date),
    pof_number: toText(entry.pgfNumber),
    member_name: toText(entry.memberName),
    username: toText(entry.username),
    new_member: toText(entry.newMember),
    member_type: toText(entry.memberType),
    package_type: toText(entry.packageType),
    to_blister: toText(entry.toBlister),
    quantity: toNumber(entry.quantity),
    blister_count: toNumber(entry.blisterCount),
    original_price: toNumber(entry.originalPrice),
    discount_label: toText(entry.discount),
    discount_rate: toNumber(entry.discount),
    one_time_discount: toNumber(entry.oneTimeDiscount),
    price_after_discount: toNumber(entry.priceAfterDiscount),
    total_sales: toNumber(entry.totalSales),
    primary_payment_mode: toText(entry.modeOfPayment),
    primary_payment_amount: primaryAmount,
    remarks: toText(entry.remarks),
    received_by: toText(entry.receivedBy),
    collected_by: toText(entry.collectedBy)
  };

  if (salesUserId) {
    // Optional link when the column exists and user can be resolved.
    salesEntryInsert.sales_user_id = salesUserId;
  }

  let salesEntryId: string | number | null = null;

  try {
    const { data: insertedEntry, error: salesInsertError } = await supabase
      .from("sales_entries")
      .insert(salesEntryInsert)
      .select("id")
      .single();

    if (salesInsertError) throw salesInsertError;

    salesEntryId = (insertedEntry as { id: string | number }).id;

    const { error: inventoryInsertError } = await supabase.from("sales_entry_inventory").insert({
      sales_entry_id: salesEntryId,
      released_bottles: toNumber(entry.releasedBottles),
      released_blisters: toNumber(entry.releasedBlister),
      to_follow_bottles: toNumber(entry.toFollowBottles),
      to_follow_blisters: toNumber(entry.toFollowBlister)
    });

    if (inventoryInsertError) throw inventoryInsertError;

    const paymentRows: Array<Record<string, unknown>> = [];

    if (toText(entry.modeOfPayment)) {
      paymentRows.push({
        sales_entry_id: salesEntryId,
        payment_no: 1,
        payment_mode: toText(entry.modeOfPayment),
        payment_type: toText(entry.paymentModeType),
        reference_number: toText(entry.referenceNumber),
        amount: primaryAmount
      });
    }

    if (toText(entry.modeOfPayment2) && secondaryAmount > 0) {
      paymentRows.push({
        sales_entry_id: salesEntryId,
        payment_no: 2,
        payment_mode: toText(entry.modeOfPayment2),
        payment_type: toText(entry.paymentModeType2),
        reference_number: toText(entry.referenceNumber2),
        amount: secondaryAmount
      });
    }

    if (paymentRows.length > 0) {
      const { error: paymentInsertError } = await supabase
        .from("sales_entry_payments")
        .insert(paymentRows);
      if (paymentInsertError) throw paymentInsertError;
    }
  } catch (error) {
    if (salesEntryId !== null) {
      await supabase.from("sales_entry_payments").delete().eq("sales_entry_id", salesEntryId);
      await supabase.from("sales_entry_inventory").delete().eq("sales_entry_id", salesEntryId);
      await supabase.from("sales_entries").delete().eq("id", salesEntryId);
    }
    throw error;
  }
}

export async function fetchSalesEntriesCount(): Promise<number> {
  const { count, error } = await supabase
    .from("sales_entries")
    .select("id", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function fetchInventoryReportRows(): Promise<SalesDashboardRawRow[]> {
  const { data, error } = await supabase.from("v_inventory_report").select("*");
  if (error) throw error;
  return (data as SalesDashboardRawRow[] | null) ?? [];
}

export async function fetchSalesReportRows(): Promise<SalesDashboardRawRow[]> {
  const { data, error } = await supabase.from("v_sales_report").select("*");
  if (error) throw error;
  return (data as SalesDashboardRawRow[] | null) ?? [];
}

async function fetchDetailRows(
  viewName: "v_bank_transfer_details" | "v_maya_details" | "v_gcash_details"
): Promise<SalesDashboardRawRow[]> {
  const { data, error } = await supabase.from(viewName).select("*");
  if (error) throw error;
  return (data as SalesDashboardRawRow[] | null) ?? [];
}

export async function fetchBankTransferDetails(): Promise<SalesDashboardRawRow[]> {
  return fetchDetailRows("v_bank_transfer_details");
}

export async function fetchMayaDetails(): Promise<SalesDashboardRawRow[]> {
  return fetchDetailRows("v_maya_details");
}

export async function fetchGcashDetails(): Promise<SalesDashboardRawRow[]> {
  return fetchDetailRows("v_gcash_details");
}
