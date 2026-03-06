import React from "react";
import { EncoderForm } from "./sales-dashboard/EncoderForm";
import type { SaleEntry } from "../types/sales";

type SalesDashboardEncoderPageProps = {
  onSave?: (entry: SaleEntry) => Promise<void> | void;
  savedCount?: number;
};

export function SalesDashboardEncoderPage({
  onSave = async () => {},
  savedCount = 0,
}: SalesDashboardEncoderPageProps) {
  return (
    <div className="w-full max-w-7xl mx-auto">
      <EncoderForm onSave={onSave} savedCount={savedCount} />
    </div>
  );
}
