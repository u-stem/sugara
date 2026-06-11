"use client";

import type {
  CurrencyCode,
  ExpenseCategory,
  ExpenseItem,
  ExpenseSplitType,
  MemberResponse,
} from "@sugara/shared";
import {
  CURRENCIES,
  convertToBase,
  EXPENSE_TITLE_MAX_LENGTH,
  expenseCategorySchema,
  formatCurrency,
  fromMinorUnits,
  getAmountInputStep,
  getSplitDisplayCurrency,
  toMinorUnits,
} from "@sugara/shared";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, getApiErrorMessage } from "@/lib/api";
import { calculateItemizedSplits, type ExpenseLineItem, minorUnitsEqual } from "@/lib/expense-calc";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

type ExpenseDialogProps = {
  tripId: string;
  tripCurrency: CurrencyCode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: ExpenseItem | null;
  onSaved: () => void;
};

export function ExpenseDialog({
  tripId,
  tripCurrency,
  open,
  onOpenChange,
  expense,
  onSaved,
}: ExpenseDialogProps) {
  const isEdit = !!expense;
  const tm = useTranslations("messages");
  const te = useTranslations("expense");
  const tc = useTranslations("common");
  const locale = useLocale();
  const tlExpCat = useTranslations("labels.expenseCategory");
  const tlSplit = useTranslations("labels.splitType");

  const { data: members = [] } = useQuery({
    queryKey: queryKeys.trips.members(tripId),
    queryFn: () => api<MemberResponse[]>(`/api/trips/${tripId}/members`),
    enabled: open,
  });

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByUserId, setPaidByUserId] = useState("");
  const [splitType, setSplitType] = useState<ExpenseSplitType>("equal");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [lineItems, setLineItems] = useState<ExpenseLineItem[]>([]);
  const [splitTheRest, setSplitTheRest] = useState(false);
  const [membersInitialized, setMembersInitialized] = useState(false);
  const [currency, setCurrency] = useState<CurrencyCode>(tripCurrency);
  const [exchangeRate, setExchangeRate] = useState("");
  const [fetchingRate, setFetchingRate] = useState(false);
  // Skip auto-fetch on initial currency set when editing an expense
  const skipAutoFetchRef = useRef(false);

  const isDifferentCurrency = currency !== tripCurrency;

  // Fetch exchange rate from API
  const fetchRate = useCallback(
    async (from: CurrencyCode, to: CurrencyCode) => {
      setFetchingRate(true);
      try {
        const data = await api<{ rate: number }>("/api/exchange-rate", {
          params: { from, to },
        });
        setExchangeRate(String(data.rate));
      } catch {
        toast.error(te("fetchRateFailed"));
      } finally {
        setFetchingRate(false);
      }
    },
    [te],
  );

  // Reset form when dialog opens
  useEffect(() => {
    if (!open) return;
    if (expense) {
      setTitle(expense.title);
      setAmount(String(fromMinorUnits(expense.amount, expense.currency)));
      setPaidByUserId(expense.paidByUserId);
      setCategory(expense.category ?? "");
      setCurrency(expense.currency);
      setExchangeRate(expense.exchangeRate ? String(Number(expense.exchangeRate)) : "");
      // Prevent auto-fetch from overwriting the pre-filled rate
      skipAutoFetchRef.current = true;

      if (expense.splitType === "itemized" && expense.lineItems && expense.lineItems.length > 0) {
        setSplitType("itemized");
        setLineItems(
          expense.lineItems.map((li) => ({
            id: li.id,
            name: li.name,
            amount: fromMinorUnits(li.amount, expense.currency),
            memberIds: new Set(li.members.map((m) => m.userId)),
          })),
        );
        setSplitTheRest(false);
      } else {
        setSplitType(expense.splitType === "itemized" ? "custom" : expense.splitType);
        setLineItems([]);
        setSplitTheRest(false);
      }

      setSelectedMembers(new Set(expense.splits.map((s) => s.userId)));
      const amounts: Record<string, string> = {};
      // Equal splits are stored in trip currency; custom/itemized use expense currency
      const splitCurrency = getSplitDisplayCurrency(
        expense.splitType,
        tripCurrency,
        expense.currency,
      );
      for (const s of expense.splits) {
        amounts[s.userId] = String(fromMinorUnits(s.amount, splitCurrency));
      }
      setCustomAmounts(amounts);
      setMembersInitialized(true);
    } else {
      setTitle("");
      setAmount("");
      setPaidByUserId("");
      setCategory("");
      setSplitType("equal");
      setSelectedMembers(new Set());
      setCustomAmounts({});
      setLineItems([]);
      setSplitTheRest(false);
      setMembersInitialized(false);
      setCurrency(tripCurrency);
      setExchangeRate("");
    }
  }, [open, expense, tripCurrency]);

  // Auto-fetch exchange rate when currency changes to a different one
  useEffect(() => {
    if (!open) return;
    if (skipAutoFetchRef.current) {
      skipAutoFetchRef.current = false;
      return;
    }
    if (currency !== tripCurrency) {
      fetchRate(currency, tripCurrency);
    } else {
      setExchangeRate("");
    }
  }, [open, currency, tripCurrency, fetchRate]);

  // Auto-select all members only on first load for new expense
  useEffect(() => {
    if (open && !membersInitialized && !expense && members.length > 0) {
      setSelectedMembers(new Set(members.map((m) => m.userId)));
      setMembersInitialized(true);
    }
  }, [open, membersInitialized, expense, members]);

  // Auto-set paidBy when members are loaded and no payer is set
  useEffect(() => {
    if (open && !paidByUserId && members.length > 0) {
      setPaidByUserId(members[0].userId);
    }
  }, [open, paidByUserId, members]);

  const toggleMember = useCallback((userId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  const customTotal = Array.from(selectedMembers).reduce(
    (sum, id) => sum + (Number(customAmounts[id]) || 0),
    0,
  );
  const parsedAmount = Number(amount) || 0;
  // Compare in minor-unit space: float addition of major units (e.g. 0.1+0.1+0.1) does not
  // equal 0.3 in IEEE 754, so a direct !== would produce a false mismatch.
  const customMismatch =
    splitType === "custom" && !minorUnitsEqual(customTotal, parsedAmount, currency);

  // Itemized split calculations
  const allMemberIds = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const itemsTotal = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  // Derive the remainder in minor units to avoid FP errors from major-unit subtraction.
  // restMinor < 1 means there is less than one minor unit left (effectively zero), which
  // prevents a ghost "split the rest" button appearing for negligible rounding residuals.
  const restMinor = toMinorUnits(parsedAmount, currency) - toMinorUnits(itemsTotal, currency);
  const restAmount = fromMinorUnits(Math.max(restMinor, 0), currency);

  const effectiveItems =
    splitTheRest && restMinor >= 1
      ? [
          ...lineItems,
          { id: "__rest__", name: te("restLabel"), amount: restAmount, memberIds: allMemberIds },
        ]
      : lineItems;

  const itemizedSplits =
    splitType === "itemized"
      ? calculateItemizedSplits(
          effectiveItems.map((item) => ({ ...item, amount: Number(item.amount) || 0 })),
          currency,
        )
      : [];

  const itemizedTotal = itemizedSplits.reduce((sum, s) => sum + s.amount, 0);
  const itemizedMismatch =
    splitType === "itemized" && !minorUnitsEqual(itemizedTotal, parsedAmount, currency);
  const hasInvalidLineItems =
    splitType === "itemized" &&
    lineItems.some((item) => item.amount <= 0 || item.memberIds.size === 0);

  // Base amount display (converted to trip currency)
  const parsedExchangeRate = Number(exchangeRate) || 0;
  const baseAmountDisplay = useMemo(() => {
    if (!isDifferentCurrency || parsedAmount <= 0 || parsedExchangeRate <= 0) return null;
    const minorAmount = toMinorUnits(parsedAmount, currency);
    const baseMinor = convertToBase(minorAmount, currency, tripCurrency, parsedExchangeRate);
    return formatCurrency(baseMinor, tripCurrency, locale);
  }, [isDifferentCurrency, parsedAmount, parsedExchangeRate, currency, tripCurrency, locale]);

  // Whether exchange rate is required but missing
  const exchangeRateMissing = isDifferentCurrency && parsedExchangeRate <= 0;

  const addLineItem = useCallback(() => {
    setLineItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "", amount: 0, memberIds: new Set(allMemberIds) },
    ]);
  }, [allMemberIds]);

  const removeLineItem = useCallback((id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateLineItem = useCallback(
    (id: string, updates: Partial<Pick<ExpenseLineItem, "name" | "amount">>) => {
      setLineItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
    },
    [],
  );

  const toggleLineItemMember = useCallback((itemId: string, userId: string) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const next = new Set(item.memberIds);
        if (next.has(userId)) {
          next.delete(userId);
        } else {
          next.add(userId);
        }
        return { ...item, memberIds: next };
      }),
    );
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedAmount <= 0 || !paidByUserId) return;
    if (isDifferentCurrency && parsedExchangeRate <= 0) return;

    let splits: { userId: string; amount?: number }[];

    if (splitType === "itemized") {
      splits = itemizedSplits;
    } else if (splitType === "custom") {
      if (selectedMembers.size === 0) return;
      splits = Array.from(selectedMembers).map((userId) => ({
        userId,
        amount: Number(customAmounts[userId]) || 0,
      }));
    } else {
      if (selectedMembers.size === 0) return;
      splits = Array.from(selectedMembers).map((userId) => ({ userId }));
    }

    const lineItemsPayload =
      splitType === "itemized"
        ? effectiveItems.map((item) => ({
            name: item.name,
            amount: Number(item.amount) || 0,
            memberIds: Array.from(item.memberIds),
          }))
        : undefined;

    setLoading(true);
    try {
      const body = {
        title,
        amount: parsedAmount,
        currency,
        ...(isDifferentCurrency ? { exchangeRate: parsedExchangeRate } : {}),
        paidByUserId,
        splitType,
        splits,
        ...(isEdit ? { category: category || null } : category ? { category } : {}),
        ...(lineItemsPayload ? { lineItems: lineItemsPayload } : {}),
      };
      if (isEdit) {
        await api(`/api/trips/${tripId}/expenses/${expense.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/trips/${tripId}/expenses`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, tm("expenseSaveFailed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEdit ? te("editTitle") : te("addTitle")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isEdit ? te("editDescription") : te("addDescription")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expense-title">
              {te("titleLabel")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="expense-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={te("titlePlaceholder")}
              maxLength={EXPENSE_TITLE_MAX_LENGTH}
              required
            />
            <p className="text-right text-xs text-muted-foreground">
              {title.length}/{EXPENSE_TITLE_MAX_LENGTH}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-category">{te("categoryLabel")}</Label>
            <Select
              value={category || "__none__"}
              onValueChange={(v) => setCategory(v === "__none__" ? "" : (v as ExpenseCategory))}
            >
              <SelectTrigger id="expense-category">
                <SelectValue placeholder={te("uncategorized")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{te("uncategorized")}</SelectItem>
                {expenseCategorySchema.options.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tlExpCat(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-currency">{te("currency")}</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
              <SelectTrigger id="expense-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CURRENCIES).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} - {locale === "ja" ? c.nameJa : c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-amount">
              {te("amountLabel")} ({currency}) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="expense-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              min={CURRENCIES[currency].decimals > 0 ? "0.01" : "1"}
              step={getAmountInputStep(currency)}
              required
            />
          </div>

          {isDifferentCurrency && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="expense-exchange-rate">
                  {te("exchangeRate")} <span className="text-destructive">*</span>
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={fetchingRate}
                  onClick={() => fetchRate(currency, tripCurrency)}
                >
                  <RefreshCw className={cn("h-3 w-3", fetchingRate && "animate-spin")} />
                  {te("fetchRate")}
                </Button>
              </div>
              <Input
                id="expense-exchange-rate"
                type="number"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
                placeholder="0"
                min="0"
                step="any"
              />
              {exchangeRateMissing && parsedAmount > 0 && (
                <p className="text-xs text-destructive">{te("exchangeRateRequired")}</p>
              )}
              {baseAmountDisplay && (
                <p className="text-sm text-muted-foreground">
                  {te("baseAmount")}: {baseAmountDisplay}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="expense-paid-by">
              {te("payerLabel")} <span className="text-destructive">*</span>
            </Label>
            <Select value={paidByUserId} onValueChange={setPaidByUserId}>
              <SelectTrigger id="expense-paid-by">
                <SelectValue placeholder={tc("select")} />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label asChild>
              <span>{te("splitMethodLabel")}</span>
            </Label>
            <Tabs value={splitType} onValueChange={(v) => setSplitType(v as ExpenseSplitType)}>
              <TabsList className="w-full">
                <TabsTrigger value="equal" className="flex-1">
                  {tlSplit("equal")}
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex-1">
                  {tlSplit("custom")}
                </TabsTrigger>
                <TabsTrigger value="itemized" className="flex-1">
                  {tlSplit("itemized")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {splitType === "equal" && te("splitEqualDescription")}
              {splitType === "custom" && te("splitCustomDescription")}
              {splitType === "itemized" && te("splitItemizedDescription")}
            </p>
          </div>

          {splitType !== "itemized" && (
            <div className="space-y-2">
              <Label asChild>
                <span>{te("targetMembers")}</span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <button
                    key={m.userId}
                    type="button"
                    onClick={() => toggleMember(m.userId)}
                    aria-pressed={selectedMembers.has(m.userId)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      selectedMembers.has(m.userId)
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
              {splitType === "custom" && (
                <div className="space-y-2">
                  {members
                    .filter((m) => selectedMembers.has(m.userId))
                    .map((m) => (
                      <div key={m.userId} className="flex items-center gap-3">
                        <span className="flex-1 text-sm">{m.name}</span>
                        <Input
                          id={`split-${m.userId}`}
                          type="number"
                          className="w-24"
                          aria-label={tc("itemMenu", { name: m.name })}
                          value={customAmounts[m.userId] ?? ""}
                          onChange={(e) =>
                            setCustomAmounts((prev) => ({ ...prev, [m.userId]: e.target.value }))
                          }
                          placeholder="0"
                          min={0}
                          step={getAmountInputStep(currency)}
                        />
                      </div>
                    ))}
                  {parsedAmount > 0 && (
                    <p
                      className={cn(
                        "text-xs",
                        customMismatch ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {te("customTotal", {
                        total: customTotal.toLocaleString(),
                        target: parsedAmount.toLocaleString(),
                      })}
                      {customMismatch &&
                        ` (${
                          parsedAmount > customTotal
                            ? te("customRemaining", {
                                amount: (parsedAmount - customTotal).toLocaleString(),
                              })
                            : te("customExceeded", {
                                amount: (customTotal - parsedAmount).toLocaleString(),
                              })
                        })`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {splitType === "itemized" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label asChild>
                  <span>{te("lineItemsLabel")}</span>
                </Label>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                  <Plus className="h-3.5 w-3.5" /> {te("addLineItem")}
                </Button>
              </div>

              {lineItems.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  {te("addLineItemPrompt")}
                </p>
              )}

              {lineItems.map((item) => (
                <div key={item.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) => updateLineItem(item.id, { name: e.target.value })}
                      placeholder={te("lineItemNamePlaceholder")}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      value={item.amount || ""}
                      onChange={(e) =>
                        updateLineItem(item.id, { amount: Number(e.target.value) || 0 })
                      }
                      placeholder={te("lineItemAmountPlaceholder")}
                      className="w-24"
                      min={0}
                      step={getAmountInputStep(currency)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeLineItem(item.id)}
                      aria-label={te("deleteLineItem")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {members.map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => toggleLineItemMember(item.id, m.userId)}
                        aria-pressed={item.memberIds.has(m.userId)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          item.memberIds.has(m.userId)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                  {item.amount <= 0 && (
                    <p className="text-xs text-destructive">{te("lineItemAmountRequired")}</p>
                  )}
                  {item.memberIds.size === 0 && (
                    <p className="text-xs text-destructive">{te("lineItemMembersRequired")}</p>
                  )}
                </div>
              ))}

              {/* Split the rest */}
              {parsedAmount > 0 && (
                <div className="space-y-2 rounded-md border border-dashed p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {itemsTotal > 0
                        ? te("lineItemsTotal", {
                            itemsTotal: itemsTotal.toLocaleString(),
                            total: parsedAmount.toLocaleString(),
                          })
                        : te("totalSpendingAmount", { amount: parsedAmount.toLocaleString() })}
                    </p>
                    {restMinor >= 1 && (
                      <Button
                        type="button"
                        variant={splitTheRest ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => setSplitTheRest((prev) => !prev)}
                      >
                        {splitTheRest
                          ? te("splitRestActive", { amount: restAmount.toLocaleString() })
                          : te("splitRestButton", { amount: restAmount.toLocaleString() })}
                      </Button>
                    )}
                  </div>

                  {/* Per-member summary */}
                  {itemizedSplits.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-xs text-muted-foreground">{te("perMemberAmount")}</p>
                      {itemizedSplits.map((s) => {
                        const member = members.find((m) => m.userId === s.userId);
                        return (
                          <div key={s.userId} className="flex items-center justify-between text-sm">
                            <span>{member?.name ?? s.userId}</span>
                            <span className="font-medium">
                              {formatCurrency(toMinorUnits(s.amount, currency), currency, locale)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                <X className="h-4 w-4" />
                {tc("cancel")}
              </Button>
            </ResponsiveDialogClose>
            <Button
              type="submit"
              disabled={
                loading ||
                !title.trim() ||
                parsedAmount <= 0 ||
                exchangeRateMissing ||
                (splitType === "equal" && selectedMembers.size === 0) ||
                (splitType === "custom" && (selectedMembers.size === 0 || customMismatch)) ||
                (splitType === "itemized" &&
                  (lineItems.length === 0 || itemizedMismatch || hasInvalidLineItems))
              }
            >
              {loading ? (
                isEdit ? (
                  te("updating")
                ) : (
                  te("adding")
                )
              ) : isEdit ? (
                <>
                  <Check className="h-4 w-4" /> {te("updateButton")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" /> {te("addButton")}
                </>
              )}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
