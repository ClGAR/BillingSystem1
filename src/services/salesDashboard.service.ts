import { supabase } from "../lib/supabaseClient";
import type { SaleEntry } from "../types/sales";

export type SalesDashboardRawRow = Record<string, unknown>;
type SaveStep = "sales_entries" | "sales_entry_inventory" | "sales_entry_payments";

const isSalesSaveDebugEnabled =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_SALES_SAVE === "true";

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const toLocalDateIso = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "t", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "f", "no", "n", "0"].includes(normalized)) return false;
  return null;
};

const debugSaveLog = (label: string, data: unknown) => {
  if (!isSalesSaveDebugEnabled) return;
  console.log(label, data);
};

const toErrorDebugMeta = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return { raw: error };
  }

  const maybeError = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
    status?: number;
  };

  return {
    message: maybeError.message,
    details: maybeError.details,
    hint: maybeError.hint,
    code: maybeError.code,
    status: maybeError.status,
    raw: error
  };
};

async function resolveSalesUserId(username: string): Promise<number | null> {
  const trimmed = username.trim();
  if (!trimmed) return null;

  try {
    const { data, error } = await supabase
      .from("sales_users")
      .select("id")
      .eq("username", trimmed)
      .maybeSingle();

    if (error) return null;
    const rawId = (data as { id?: number | string } | null)?.id;
    const parsed = typeof rawId === "number" ? rawId : Number(rawId);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSalesEntry(entry: SaleEntry): Promise<void> {
  const primaryAmount = Math.max(0, toNumber(entry.totalSales) - toNumber(entry.amount2));
  const secondaryAmount = Math.max(0, toNumber(entry.amount2));
  const salesUserIdPromise = resolveSalesUserId(entry.username);
  const authUserPromise = supabase.auth.getUser();

  const [salesUserId, authUserResult] = await Promise.all([salesUserIdPromise, authUserPromise]);
  const authUserId = authUserResult.data.user?.id ?? null;
  const saleDate = toText(entry.date) || toLocalDateIso();
  const pofNumber = toText(entry.pgfNumber) || null;
  const newMember = toBoolean(entry.newMember);
  const toBlister = toBoolean(entry.toBlister);
  const discountValue = toNumber(entry.discount);

  const salesEntryInsert: Record<string, unknown> = {
    event: toText(entry.event),
    // Keep both old/new column keys to support current and legacy table versions.
    report_date: saleDate,
    entry_date: saleDate,
    sale_date: saleDate,
    pof_number: pofNumber,
    po_number: pofNumber,
    member_name: toText(entry.memberName),
    username: toText(entry.username),
    new_member: newMember,
    is_new_member: newMember ?? false,
    member_type: toText(entry.memberType),
    package_type: toText(entry.packageType),
    to_blister: toBlister ?? false,
    quantity: toNumber(entry.quantity),
    blister_count: toNumber(entry.blisterCount),
    original_price: toNumber(entry.originalPrice),
    discount_label: toText(entry.discount),
    discount_rate: discountValue,
    discount_percent: discountValue,
    one_time_discount: toNumber(entry.oneTimeDiscount),
    price_after_discount: toNumber(entry.priceAfterDiscount),
    total_sales: toNumber(entry.totalSales),
    primary_payment_mode: toText(entry.modeOfPayment),
    primary_payment_amount: primaryAmount,
    remarks: toText(entry.remarks),
    received_by: toText(entry.receivedBy),
    collected_by: toText(entry.collectedBy)
  };

  if (salesUserId !== null) {
    // Optional link when username can be resolved.
    salesEntryInsert.sales_user_id = salesUserId;
  }
  if (authUserId) {
    // Helps satisfy common INSERT RLS policy shape: created_by = auth.uid().
    salesEntryInsert.created_by = authUserId;
  }

  let salesEntryId: string | number | null = null;
  let failedStep: SaveStep | null = null;

  debugSaveLog("SAVE PAYLOAD", {
    table: "sales_entries",
    authUserId,
    payload: salesEntryInsert
  });

  try {
    failedStep = "sales_entries";
    const { data: insertedEntry, error: salesInsertError } = await supabase
      .from("sales_entries")
      .insert(salesEntryInsert)
      .select("id")
      .single();

    debugSaveLog("SAVE RESPONSE", {
      table: "sales_entries",
      response: insertedEntry,
      error: salesInsertError
    });

    if (salesInsertError) throw salesInsertError;

    salesEntryId = (insertedEntry as { id: string | number }).id;

    const inventoryInsertPayload = {
      // Keep both old/new key sets for compatibility.
      sale_entry_id: salesEntryId,
      sales_entry_id: salesEntryId,
      released_bottle: toNumber(entry.releasedBottles),
      released_bottles: toNumber(entry.releasedBottles),
      released_blister: toNumber(entry.releasedBlister),
      released_blisters: toNumber(entry.releasedBlister),
      to_follow_bottle: toNumber(entry.toFollowBottles),
      to_follow_bottles: toNumber(entry.toFollowBottles),
      to_follow_blister: toNumber(entry.toFollowBlister),
      to_follow_blisters: toNumber(entry.toFollowBlister)
    };

    debugSaveLog("SAVE PAYLOAD", {
      table: "sales_entry_inventory",
      payload: inventoryInsertPayload
    });

    failedStep = "sales_entry_inventory";
    const { error: inventoryInsertError } = await supabase
      .from("sales_entry_inventory")
      .insert(inventoryInsertPayload);

    debugSaveLog("SAVE RESPONSE", {
      table: "sales_entry_inventory",
      error: inventoryInsertError
    });

    if (inventoryInsertError) throw inventoryInsertError;

    const paymentRows: Array<Record<string, unknown>> = [];

    if (toText(entry.modeOfPayment)) {
      paymentRows.push({
        sale_entry_id: salesEntryId,
        sales_entry_id: salesEntryId,
        payment_no: 1,
        mode: toText(entry.modeOfPayment),
        payment_mode: toText(entry.modeOfPayment),
        mode_type: toText(entry.paymentModeType),
        payment_type: toText(entry.paymentModeType),
        reference_no: toText(entry.referenceNumber),
        reference_number: toText(entry.referenceNumber),
        amount: primaryAmount
      });
    }

    if (toText(entry.modeOfPayment2) && secondaryAmount > 0) {
      paymentRows.push({
        sale_entry_id: salesEntryId,
        sales_entry_id: salesEntryId,
        payment_no: 2,
        mode: toText(entry.modeOfPayment2),
        payment_mode: toText(entry.modeOfPayment2),
        mode_type: toText(entry.paymentModeType2),
        payment_type: toText(entry.paymentModeType2),
        reference_no: toText(entry.referenceNumber2),
        reference_number: toText(entry.referenceNumber2),
        amount: secondaryAmount
      });
    }

    if (paymentRows.length > 0) {
      debugSaveLog("SAVE PAYLOAD", {
        table: "sales_entry_payments",
        payload: paymentRows
      });

      failedStep = "sales_entry_payments";
      const { error: paymentInsertError } = await supabase
        .from("sales_entry_payments")
        .insert(paymentRows);

      debugSaveLog("SAVE RESPONSE", {
        table: "sales_entry_payments",
        error: paymentInsertError
      });

      if (paymentInsertError) throw paymentInsertError;
    }
  } catch (error) {
    console.error("SAVE ERROR", {
      step: failedStep,
      table: failedStep,
      salesEntryId,
      error: toErrorDebugMeta(error)
    });

    if (salesEntryId !== null) {
      const paymentDeleteFilter = `sales_entry_id.eq.${salesEntryId},sale_entry_id.eq.${salesEntryId}`;

      await supabase.from("sales_entry_payments").delete().or(paymentDeleteFilter);
      await supabase.from("sales_entry_inventory").delete().or(paymentDeleteFilter);
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

export async function fetchDailyCashCountRows(): Promise<SalesDashboardRawRow[]> {
  const { data, error } = await supabase.from("v_daily_cash_count").select("*");
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
