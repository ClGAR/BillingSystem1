import React, { useEffect, useMemo, useState } from "react";
import {
  fetchBankTransferDetails,
  fetchGcashDetails,
  fetchMayaDetails,
  fetchSalesReportRows,
  type SalesDashboardRawRow
} from "../services/salesDashboard.service";

const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25] as const;

const formatMoney = (value: number) =>
  value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DEFAULT_PRICE = {
  platinum: 35000,
  gold: 10500,
  silver: 3500,
  bottle: 2280,
  blister: 779
};

type DetailRow = {
  memberName: string;
  referenceNo: string;
  amount: number;
};

const DATE_KEYS = ["report_date", "entry_date", "date", "transaction_date", "created_at"];

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const pickString = (row: SalesDashboardRawRow, keys: string[], fallback = ""): string => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
};

const pickNumber = (row: SalesDashboardRawRow, keys: string[]): number => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null) return toNumber(value);
  }
  return 0;
};

const toSearchText = (row: SalesDashboardRawRow): string =>
  Object.values(row)
    .map((value) => (typeof value === "string" ? value.toLowerCase() : String(value ?? "")))
    .join(" ");

const isRowForDate = (row: SalesDashboardRawRow, reportDate: string): boolean => {
  const value = pickString(row, DATE_KEYS);
  if (!value) return true;
  return value.slice(0, 10) === reportDate;
};

const mapDetailRows = (rows: SalesDashboardRawRow[]): DetailRow[] =>
  rows.map((row) => ({
    memberName: pickString(row, ["member_name", "name", "full_name"], "-"),
    referenceNo: pickString(row, ["reference_number", "reference_no", "reference"], "-"),
    amount: pickNumber(row, ["amount", "total_amount", "value"])
  }));

type MetricResult = {
  qty: number;
  price: number;
  amount: number;
  matched: boolean;
};

function aggregateMetric(
  rows: SalesDashboardRawRow[],
  itemKeywords: string[],
  options?: { sectionKeywords?: string[]; fallbackPrice?: number }
): MetricResult {
  const sectionKeywords = options?.sectionKeywords ?? [];
  const fallbackPrice = options?.fallbackPrice ?? 0;

  const matches = rows.filter((row) => {
    const text = toSearchText(row);
    const itemMatch = itemKeywords.some((keyword) => text.includes(keyword));
    const sectionMatch =
      sectionKeywords.length === 0 || sectionKeywords.some((keyword) => text.includes(keyword));
    return itemMatch && sectionMatch;
  });

  if (matches.length === 0) {
    return {
      qty: 0,
      price: fallbackPrice,
      amount: 0,
      matched: false
    };
  }

  const qty = matches.reduce((sum, row) => sum + pickNumber(row, ["qty", "quantity", "count"]), 0);
  const amount = matches.reduce(
    (sum, row) => sum + pickNumber(row, ["amount_total", "total_amount", "amount", "total", "value"]),
    0
  );
  const explicitPrice = matches.find((row) => pickNumber(row, ["price", "unit_price", "rate"]) > 0);
  const price = explicitPrice
    ? pickNumber(explicitPrice, ["price", "unit_price", "rate"])
    : fallbackPrice;

  return {
    qty,
    price,
    amount,
    matched: true
  };
}

function aggregateWithFallback(
  rows: SalesDashboardRawRow[],
  itemKeywords: string[],
  sectionKeywords: string[],
  fallbackPrice: number
): MetricResult {
  const sectionScoped = aggregateMetric(rows, itemKeywords, { sectionKeywords, fallbackPrice });
  if (sectionScoped.matched) return sectionScoped;
  return aggregateMetric(rows, itemKeywords, { fallbackPrice });
}

function SalesTableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="bg-gray-100">
        {cols.map((col, idx) => (
          <th
            key={`${col}-${idx}`}
            className={`border border-black px-2 py-1 font-bold ${idx === 0 ? "text-left" : "text-right"}`}
          >
            {col}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SalesRow({ label, qty, price, amount }: { label: string; qty: number; price: number; amount: number }) {
  return (
    <tr>
      <td className="border border-black px-2 py-1">{label}</td>
      <td className="border border-black px-2 py-1 text-right">{qty}</td>
      <td className="border border-black px-2 py-1 text-right">{formatMoney(price)}</td>
      <td className="border border-black px-2 py-1 text-right">{formatMoney(amount)}</td>
    </tr>
  );
}

function TotalRow({ label, amount }: { label: string; amount: number }) {
  return (
    <tr>
      <td className="border border-black px-2 py-1 font-bold" colSpan={3}>
        {label}
      </td>
      <td className="border border-black px-2 py-1 text-right font-bold">{formatMoney(amount)}</td>
    </tr>
  );
}

export function SalesDashboardSalesReportPage() {
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [preparedBy, setPreparedBy] = useState("");
  const [checkedBy, setCheckedBy] = useState("");
  const [cashPieces, setCashPieces] = useState<Record<string, string>>(() =>
    Object.fromEntries(DENOMINATIONS.map((denom) => [String(denom), "0"]))
  );

  const [summaryRows, setSummaryRows] = useState<SalesDashboardRawRow[]>([]);
  const [bankRows, setBankRows] = useState<DetailRow[]>([]);
  const [mayaRows, setMayaRows] = useState<DetailRow[]>([]);
  const [gcashRows, setGcashRows] = useState<DetailRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadReportData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [summaryData, bankData, mayaData, gcashData] = await Promise.all([
          fetchSalesReportRows(),
          fetchBankTransferDetails(),
          fetchMayaDetails(),
          fetchGcashDetails()
        ]);

        if (!active) return;

        setSummaryRows(summaryData.filter((row) => isRowForDate(row, reportDate)));
        setBankRows(mapDetailRows(bankData.filter((row) => isRowForDate(row, reportDate))));
        setMayaRows(mapDetailRows(mayaData.filter((row) => isRowForDate(row, reportDate))));
        setGcashRows(mapDetailRows(gcashData.filter((row) => isRowForDate(row, reportDate))));
      } catch (fetchError) {
        if (!active) return;
        const message =
          fetchError instanceof Error ? fetchError.message : "Failed to load sales report.";
        setError(message);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadReportData();
    return () => {
      active = false;
    };
  }, [reportDate]);

  const packageSectionRows = useMemo(() => {
    const section = ["package sales", "member type"];
    return [
      {
        label: "Mobile Stockist",
        ...aggregateWithFallback(summaryRows, ["mobile stockist"], section, 0)
      },
      {
        label: "Platinum",
        ...aggregateWithFallback(summaryRows, ["platinum"], section, DEFAULT_PRICE.platinum)
      },
      {
        label: "Gold",
        ...aggregateWithFallback(summaryRows, ["gold"], section, DEFAULT_PRICE.gold)
      },
      {
        label: "Silver",
        ...aggregateWithFallback(summaryRows, ["silver"], section, DEFAULT_PRICE.silver)
      }
    ];
  }, [summaryRows]);

  const mobileStockistPackageRows = useMemo(() => {
    const section = ["mobile stockist package"];
    return [
      {
        label: "Platinum",
        ...aggregateWithFallback(summaryRows, ["platinum"], section, DEFAULT_PRICE.platinum)
      },
      {
        label: "Gold",
        ...aggregateWithFallback(summaryRows, ["gold"], section, DEFAULT_PRICE.gold)
      },
      {
        label: "Silver",
        ...aggregateWithFallback(summaryRows, ["silver"], section, DEFAULT_PRICE.silver)
      }
    ];
  }, [summaryRows]);

  const depotPackageRows = useMemo(() => {
    const section = ["depot packs", "depot package", "depot pack"];
    return [
      {
        label: "Platinum",
        ...aggregateWithFallback(summaryRows, ["platinum"], section, DEFAULT_PRICE.platinum)
      },
      {
        label: "Gold",
        ...aggregateWithFallback(summaryRows, ["gold"], section, DEFAULT_PRICE.gold)
      },
      {
        label: "Silver",
        ...aggregateWithFallback(summaryRows, ["silver"], section, DEFAULT_PRICE.silver)
      }
    ];
  }, [summaryRows]);

  const retailRows = useMemo(() => {
    const section = ["retail"];
    return [
      {
        label: "Synbiotic+ (Bottle)",
        ...aggregateWithFallback(summaryRows, ["bottle"], section, DEFAULT_PRICE.bottle)
      },
      {
        label: "Synbiotic+ (Blister)",
        ...aggregateWithFallback(summaryRows, ["blister"], section, DEFAULT_PRICE.blister)
      },
      {
        label: "Employee Discount",
        ...aggregateWithFallback(summaryRows, ["employee discount"], section, 0)
      }
    ];
  }, [summaryRows]);

  const mobileStockistRetailRow = useMemo(
    () =>
      aggregateWithFallback(
        summaryRows,
        ["mobile stockist retail", "bottle"],
        ["mobile stockist retail"],
        DEFAULT_PRICE.bottle
      ),
    [summaryRows]
  );

  const depotRetailRow = useMemo(
    () =>
      aggregateWithFallback(summaryRows, ["depot retail", "bottle"], ["depot retail"], DEFAULT_PRICE.bottle),
    [summaryRows]
  );

  const sumAmount = (rows: Array<{ amount: number }>) => rows.reduce((sum, row) => sum + row.amount, 0);

  const packageSalesTotal = sumAmount(packageSectionRows);
  const mobileStockistPackageTotal = sumAmount(mobileStockistPackageRows);
  const depotPackageTotal = sumAmount(depotPackageRows);
  const retailTotal = sumAmount(retailRows);
  const mobileStockistRetailTotal = mobileStockistRetailRow.amount;
  const depotRetailTotal = depotRetailRow.amount;
  const grandTotal =
    packageSalesTotal +
    mobileStockistPackageTotal +
    depotPackageTotal +
    retailTotal +
    mobileStockistRetailTotal +
    depotRetailTotal;

  const detailsTotal = (rows: DetailRow[]) => rows.reduce((sum, row) => sum + row.amount, 0);
  const bankTotal = detailsTotal(bankRows);
  const mayaTotal = detailsTotal(mayaRows);
  const gcashTotal = detailsTotal(gcashRows);

  const resolvePaymentAmount = (keywords: string[], fallback: number): number => {
    const matched = summaryRows.filter((row) =>
      keywords.some((keyword) => toSearchText(row).includes(keyword))
    );
    if (!matched.length) return fallback;
    return matched.reduce(
      (sum, row) => sum + pickNumber(row, ["amount_total", "total_amount", "amount", "total", "value"]),
      0
    );
  };

  const paymentRows = useMemo(
    () => [
      { label: "Cash on Hand", amount: resolvePaymentAmount(["cash on hand", "cash"], 0) },
      { label: "E-Wallet", amount: resolvePaymentAmount(["e-wallet", "ewallet"], 0) },
      { label: "Bank Transfer", amount: resolvePaymentAmount(["bank transfer", "bank"], bankTotal) },
      { label: "Maya", amount: resolvePaymentAmount(["maya"], mayaTotal) },
      { label: "GCash", amount: resolvePaymentAmount(["gcash"], gcashTotal) },
      { label: "Cheque", amount: resolvePaymentAmount(["cheque", "check"], 0) }
    ],
    [summaryRows, bankTotal, mayaTotal, gcashTotal]
  );

  const getNewAccountsCount = (memberType: "silver" | "gold" | "platinum"): number => {
    const matched = summaryRows.filter((row) => {
      const text = toSearchText(row);
      return text.includes("new account") && text.includes(memberType);
    });
    if (!matched.length) return 0;
    return matched.reduce((sum, row) => sum + pickNumber(row, ["count", "qty", "quantity"]), 0);
  };

  const newSilver = getNewAccountsCount("silver");
  const newGold = getNewAccountsCount("gold");
  const newPlatinum = getNewAccountsCount("platinum");
  const upgradesCount = resolvePaymentAmount(["upgrade", "upgrades"], 0);

  const cashRows = useMemo(
    () =>
      DENOMINATIONS.map((denom) => {
        const pieces = toNumber(cashPieces[String(denom)] || "0");
        return {
          label: denom === 0.25 ? "0.25" : String(denom),
          pieces,
          amount: denom * pieces
        };
      }),
    [cashPieces]
  );

  const totalCash = cashRows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="bg-white rounded-md border border-gray-300 p-3 text-[11px] leading-tight">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body * { visibility: hidden; }
          #sales-report-print, #sales-report-print * { visibility: visible; }
          #sales-report-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="mb-3 flex items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2">
          <span>Report Date:</span>
          <input
            type="date"
            value={reportDate}
            onChange={(event) => setReportDate(event.target.value)}
            className="border border-black px-2 py-1 text-[11px]"
          />
        </div>
        <button type="button" onClick={() => window.print()} className="rounded border border-black px-3 py-1">
          Print Report
        </button>
      </div>

      {error ? (
        <div className="mb-3 border border-red-200 bg-red-50 px-3 py-2 text-red-700">{error}</div>
      ) : null}

      <div id="sales-report-print">
        <div className="border border-black p-2">
          <div className="text-center font-bold">Company Name</div>
          <div className="text-center font-bold">Daily Sales Report</div>
          <div className="text-center">Date: {reportDate}</div>

          {isLoading ? (
            <div className="py-6 text-center">Loading sales report...</div>
          ) : (
            <>
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: "58% 42%" }}>
                <div className="space-y-2">
                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["PACKAGE SALES (Member Type)", "QTY", "PRICE", "AMOUNT TOTAL"]} />
                    <tbody>
                      {packageSectionRows.map((row) => (
                        <SalesRow
                          key={`package-${row.label}`}
                          label={row.label}
                          qty={row.qty}
                          price={row.price}
                          amount={row.amount}
                        />
                      ))}
                      <TotalRow label="Total Package Sales" amount={packageSalesTotal} />
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["MOBILE STOCKIST PACKAGE", "QTY", "PRICE", "AMOUNT TOTAL"]} />
                    <tbody>
                      {mobileStockistPackageRows.map((row) => (
                        <SalesRow
                          key={`mobile-stockist-package-${row.label}`}
                          label={row.label}
                          qty={row.qty}
                          price={row.price}
                          amount={row.amount}
                        />
                      ))}
                      <TotalRow
                        label="Total Mobile Stockist Package Sales"
                        amount={mobileStockistPackageTotal}
                      />
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["DEPOT PACKS", "QTY", "PRICE", "AMOUNT TOTAL"]} />
                    <tbody>
                      {depotPackageRows.map((row) => (
                        <SalesRow
                          key={`depot-package-${row.label}`}
                          label={row.label}
                          qty={row.qty}
                          price={row.price}
                          amount={row.amount}
                        />
                      ))}
                      <TotalRow label="Total Depot Package Sales" amount={depotPackageTotal} />
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["RETAIL ITEM", "QTY", "PRICE", "AMOUNT TOTAL"]} />
                    <tbody>
                      {retailRows.map((row) => (
                        <SalesRow
                          key={`retail-${row.label}`}
                          label={row.label}
                          qty={row.qty}
                          price={row.price}
                          amount={row.amount}
                        />
                      ))}
                      <TotalRow label="Total Retail Sales" amount={retailTotal} />
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["MOBILE STOCKIST RETAIL", "QTY", "PRICE", "AMOUNT TOTAL"]} />
                    <tbody>
                      <SalesRow
                        label="Synbiotic+ (Bottle)"
                        qty={mobileStockistRetailRow.qty}
                        price={mobileStockistRetailRow.price}
                        amount={mobileStockistRetailRow.amount}
                      />
                      <TotalRow label="Total Mobile Stockist Retail Sales" amount={mobileStockistRetailTotal} />
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["DEPOT RETAIL", "QTY", "PRICE", "AMOUNT TOTAL"]} />
                    <tbody>
                      <SalesRow
                        label="Synbiotic+ (Bottle)"
                        qty={depotRetailRow.qty}
                        price={depotRetailRow.price}
                        amount={depotRetailRow.amount}
                      />
                      <TotalRow label="Total Depot Retail Sales" amount={depotRetailTotal} />
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <tbody>
                      <tr className="bg-gray-100">
                        <td className="border border-black px-2 py-1 font-bold">GRAND TOTAL</td>
                        <td className="border border-black px-2 py-1 text-right font-bold">
                          {formatMoney(grandTotal)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2">
                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["DENOMINATION", "PIECES", "AMOUNT"]} />
                    <tbody>
                      {cashRows.map((row) => (
                        <tr key={row.label}>
                          <td className="border border-black px-2 py-1">{row.label}</td>
                          <td className="border border-black px-2 py-1">
                            <input
                              type="number"
                              min="0"
                              value={cashPieces[row.label] || "0"}
                              onChange={(event) =>
                                setCashPieces((prev) => ({
                                  ...prev,
                                  [row.label]: event.target.value
                                }))
                              }
                              className="w-full border-0 p-0 text-right text-[11px] outline-none"
                            />
                          </td>
                          <td className="border border-black px-2 py-1 text-right">
                            {formatMoney(row.amount)}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="border border-black px-2 py-1 font-bold" colSpan={2}>
                          Total Cash
                        </td>
                        <td className="border border-black px-2 py-1 text-right font-bold">
                          {formatMoney(totalCash)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <table className="w-full border-collapse border border-black">
                    <SalesTableHeader cols={["PAYMENT METHOD", "AMOUNT"]} />
                    <tbody>
                      {paymentRows.map((row) => (
                        <tr key={row.label}>
                          <td className="border border-black px-2 py-1">{row.label}</td>
                          <td className="border border-black px-2 py-1 text-right">
                            {formatMoney(row.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <table className="w-full border-collapse border border-black">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-black px-2 py-1 text-left font-bold" colSpan={2}>
                        NEW ACCOUNTS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black px-2 py-1">Silver</td>
                      <td className="border border-black px-2 py-1 text-right">{newSilver}</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1">Gold</td>
                      <td className="border border-black px-2 py-1 text-right">{newGold}</td>
                    </tr>
                    <tr>
                      <td className="border border-black px-2 py-1">Platinum</td>
                      <td className="border border-black px-2 py-1 text-right">{newPlatinum}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="w-full border-collapse border border-black">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-black px-2 py-1 text-left font-bold">UPGRADES</th>
                      <th className="border border-black px-2 py-1 text-right font-bold">COUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-black px-2 py-1">Total Upgrades</td>
                      <td className="border border-black px-2 py-1 text-right">{Math.round(upgradesCount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3 space-y-2">
                <table className="w-full border-collapse border border-black">
                  <thead>
                    <tr>
                      <th className="border border-black px-2 py-1 text-left font-bold" colSpan={3}>
                        BANK TRANSFER DETAILS
                      </th>
                    </tr>
                    <tr className="bg-gray-100">
                      <th className="border border-black px-2 py-1 text-left font-bold">Member Name</th>
                      <th className="border border-black px-2 py-1 text-left font-bold">Reference No</th>
                      <th className="border border-black px-2 py-1 text-right font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bankRows.length ? bankRows : [{ memberName: "-", referenceNo: "-", amount: 0 }]).map(
                      (row, index) => (
                        <tr key={`bank-${index}`}>
                          <td className="border border-black px-2 py-1">{row.memberName}</td>
                          <td className="border border-black px-2 py-1">{row.referenceNo}</td>
                          <td className="border border-black px-2 py-1 text-right">
                            {formatMoney(row.amount)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>

                <table className="w-full border-collapse border border-black">
                  <thead>
                    <tr>
                      <th className="border border-black px-2 py-1 text-left font-bold" colSpan={3}>
                        MAYA DETAILS
                      </th>
                    </tr>
                    <tr className="bg-gray-100">
                      <th className="border border-black px-2 py-1 text-left font-bold">Member Name</th>
                      <th className="border border-black px-2 py-1 text-left font-bold">Reference No</th>
                      <th className="border border-black px-2 py-1 text-right font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mayaRows.length ? mayaRows : [{ memberName: "-", referenceNo: "-", amount: 0 }]).map(
                      (row, index) => (
                        <tr key={`maya-${index}`}>
                          <td className="border border-black px-2 py-1">{row.memberName}</td>
                          <td className="border border-black px-2 py-1">{row.referenceNo}</td>
                          <td className="border border-black px-2 py-1 text-right">
                            {formatMoney(row.amount)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>

                <table className="w-full border-collapse border border-black">
                  <thead>
                    <tr>
                      <th className="border border-black px-2 py-1 text-left font-bold" colSpan={3}>
                        GCASH DETAILS
                      </th>
                    </tr>
                    <tr className="bg-gray-100">
                      <th className="border border-black px-2 py-1 text-left font-bold">Member Name</th>
                      <th className="border border-black px-2 py-1 text-left font-bold">Reference No</th>
                      <th className="border border-black px-2 py-1 text-right font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(gcashRows.length ? gcashRows : [{ memberName: "-", referenceNo: "-", amount: 0 }]).map(
                      (row, index) => (
                        <tr key={`gcash-${index}`}>
                          <td className="border border-black px-2 py-1">{row.memberName}</td>
                          <td className="border border-black px-2 py-1">{row.referenceNo}</td>
                          <td className="border border-black px-2 py-1 text-right">
                            {formatMoney(row.amount)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className="mt-4 grid grid-cols-2 gap-8">
            <div>
              <div>Prepared By</div>
              <input
                type="text"
                value={preparedBy}
                onChange={(event) => setPreparedBy(event.target.value)}
                className="mt-2 w-full border-b border-black py-1 outline-none"
              />
            </div>
            <div>
              <div>Checked By</div>
              <input
                type="text"
                value={checkedBy}
                onChange={(event) => setCheckedBy(event.target.value)}
                className="mt-2 w-full border-b border-black py-1 outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
