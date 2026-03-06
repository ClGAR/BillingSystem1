import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Route } from "react-router-dom";
import { SalesDashboardLayout } from "../components/SalesDashboardLayout";
import { SalesDashboardEncoderPage } from "../components/SalesDashboardEncoderPage";
import { SalesDashboardSalesReportPage } from "../components/SalesDashboardSalesReportPage";
import { InventoryReportPage } from "../app/components/inventory-report-page";
import type { SaleEntry } from "../types/sales";
import { fetchSalesEntriesCount, saveSalesEntry } from "../services/salesDashboard.service";

type SalesDashboardEntriesContextValue = {
  savedCount: number;
  onSaveEntry: (entry: SaleEntry) => Promise<void>;
};

const SalesDashboardEntriesContext = createContext<SalesDashboardEntriesContextValue | null>(null);

function SalesDashboardStateShell() {
  const [savedCount, setSavedCount] = useState(0);

  const refreshSavedCount = useCallback(async () => {
    const count = await fetchSalesEntriesCount();
    setSavedCount(count);
  }, []);

  useEffect(() => {
    void refreshSavedCount();
  }, [refreshSavedCount]);

  const onSaveEntry = useCallback(
    async (entry: SaleEntry) => {
      await saveSalesEntry(entry);
      await refreshSavedCount();
    },
    [refreshSavedCount]
  );

  const value = useMemo<SalesDashboardEntriesContextValue>(
    () => ({
      savedCount,
      onSaveEntry
    }),
    [savedCount, onSaveEntry]
  );

  return (
    <SalesDashboardEntriesContext.Provider value={value}>
      <SalesDashboardLayout />
    </SalesDashboardEntriesContext.Provider>
  );
}

function useSalesDashboardEntries() {
  const context = useContext(SalesDashboardEntriesContext);
  if (!context) {
    throw new Error("useSalesDashboardEntries must be used within SalesDashboardStateShell.");
  }
  return context;
}

function SalesDashboardEncoderRoute() {
  const { savedCount, onSaveEntry } = useSalesDashboardEntries();
  return <SalesDashboardEncoderPage onSave={onSaveEntry} savedCount={savedCount} />;
}

function SalesDashboardSalesReportRoute() {
  return <SalesDashboardSalesReportPage />;
}

export const salesDashboardRoutes = (
  <Route path="/sales-dashboard" element={<SalesDashboardStateShell />}>
    <Route index element={<Navigate to="encoder" replace />} />
    <Route path="encoder" element={<SalesDashboardEncoderRoute />} />
    <Route path="inventory-report" element={<InventoryReportPage />} />
    <Route path="sales-report" element={<SalesDashboardSalesReportRoute />} />
  </Route>
);
