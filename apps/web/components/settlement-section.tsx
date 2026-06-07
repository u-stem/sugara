"use client";

import type { CurrencyCode, ExpensesResponse, Settlement, SettlementPayment } from "@sugara/shared";
import { formatCurrency } from "@sugara/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, apiVoid, getApiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type SettlementMode = "minimal" | "direct";
const SETTLEMENT_MODE_KEY = "sugara:settlement-mode";

type SettlementSectionProps = {
  tripId: string;
  settlement: Settlement;
  settlementPayments: SettlementPayment[];
  currentUserId: string | undefined;
  tripCurrency: CurrencyCode;
};

function findPayment(
  payments: SettlementPayment[],
  fromId: string,
  toId: string,
  amount: number,
): SettlementPayment | undefined {
  return payments.find(
    (p) => p.fromUserId === fromId && p.toUserId === toId && p.amount === amount,
  );
}

export function SettlementSection({
  tripId,
  settlement,
  settlementPayments,
  currentUserId,
  tripCurrency,
}: SettlementSectionProps) {
  const tm = useTranslations("messages");
  const te = useTranslations("expense");
  const locale = useLocale();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<SettlementMode>("minimal");
  useEffect(() => {
    const saved = localStorage.getItem(SETTLEMENT_MODE_KEY);
    if (saved === "minimal" || saved === "direct") setMode(saved);
  }, []);
  const changeMode = (next: SettlementMode) => {
    setMode(next);
    localStorage.setItem(SETTLEMENT_MODE_KEY, next);
  };

  const source = mode === "minimal" ? settlement.transfers : settlement.directTransfers;
  const transfers = [...source].sort((a, b) => b.amount - a.amount);
  const checkedCount = transfers.filter((t) =>
    findPayment(settlementPayments, t.from.id, t.to.id, t.amount),
  ).length;
  const allChecked = transfers.length > 0 && checkedCount === transfers.length;

  const expenseQueryKey = queryKeys.expenses.list(tripId);

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
    if (currentUserId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.settlement.unsettled(currentUserId),
      });
    }
  };

  const checkMutation = useMutation({
    mutationFn: (body: { fromUserId: string; toUserId: string; amount: number }) =>
      api<SettlementPayment>(`/api/trips/${tripId}/settlement-payments`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: expenseQueryKey });
      const previous = queryClient.getQueryData<ExpensesResponse>(expenseQueryKey);
      if (previous) {
        // Optimistic: add a temporary payment entry
        const optimistic: SettlementPayment = {
          id: `optimistic-${Date.now()}`,
          tripId,
          fromUserId: body.fromUserId,
          toUserId: body.toUserId,
          amount: body.amount,
          paidAt: new Date().toISOString(),
          paidByUserId: currentUserId ?? body.fromUserId,
        };
        queryClient.setQueryData<ExpensesResponse>(expenseQueryKey, {
          ...previous,
          settlementPayments: [...previous.settlementPayments, optimistic],
        });
      }
      return { previous };
    },
    onSuccess: (realPayment, _body) => {
      // Replace optimistic entry with server response (real ID)
      const current = queryClient.getQueryData<ExpensesResponse>(expenseQueryKey);
      if (current) {
        queryClient.setQueryData<ExpensesResponse>(expenseQueryKey, {
          ...current,
          settlementPayments: current.settlementPayments.map((p) =>
            p.id.startsWith("optimistic-") &&
            p.fromUserId === realPayment.fromUserId &&
            p.toUserId === realPayment.toUserId &&
            p.amount === realPayment.amount
              ? realPayment
              : p,
          ),
        });
      }
      invalidateRelated();
    },
    onError: (err, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(expenseQueryKey, context.previous);
      }
      toast.error(
        getApiErrorMessage(err, tm("settlementCheckFailed"), {
          conflict: tm("settlementAlreadyChecked"),
        }),
      );
    },
  });

  const uncheckMutation = useMutation({
    mutationFn: (vars: {
      paymentId: string;
      fromUserId: string;
      toUserId: string;
      amount: number;
    }) =>
      apiVoid(`/api/trips/${tripId}/settlement-payments/${vars.paymentId}`, {
        method: "DELETE",
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: expenseQueryKey });
      const previous = queryClient.getQueryData<ExpensesResponse>(expenseQueryKey);
      if (previous) {
        queryClient.setQueryData<ExpensesResponse>(expenseQueryKey, {
          ...previous,
          settlementPayments: previous.settlementPayments.filter((p) => p.id !== vars.paymentId),
        });
      }
      return { previous };
    },
    onSuccess: () => {
      invalidateRelated();
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(expenseQueryKey, context.previous);
      }
      toast.error(getApiErrorMessage(err, tm("settlementUncheckFailed")));
    },
  });

  const handleToggle = (fromId: string, toId: string, amount: number) => {
    const existing = findPayment(settlementPayments, fromId, toId, amount);
    if (existing) {
      if (existing.id.startsWith("optimistic-")) {
        // Still pending on server — just remove from cache
        const current = queryClient.getQueryData<ExpensesResponse>(expenseQueryKey);
        if (current) {
          queryClient.setQueryData<ExpensesResponse>(expenseQueryKey, {
            ...current,
            settlementPayments: current.settlementPayments.filter((p) => p.id !== existing.id),
          });
        }
      } else {
        uncheckMutation.mutate({
          paymentId: existing.id,
          fromUserId: fromId,
          toUserId: toId,
          amount,
        });
      }
    } else {
      checkMutation.mutate({ fromUserId: fromId, toUserId: toId, amount });
    }
  };

  if (transfers.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border bg-muted/50 px-3 pt-2 pb-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{te("settlement")}</span>
        {mode === "minimal" && (
          <span
            className={`text-xs ${allChecked ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
          >
            {allChecked
              ? te("settlementComplete")
              : te("settlementProgress", { checked: checkedCount, total: transfers.length })}
          </span>
        )}
      </div>
      <Tabs
        value={mode}
        onValueChange={(v) => {
          // Type guard instead of a cast keeps onValueChange's string narrowed.
          if (v === "direct" || v === "minimal") changeMode(v);
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="direct" className="flex-1">
            {te("settlementModeDirect")}
          </TabsTrigger>
          <TabsTrigger value="minimal" className="flex-1">
            {te("settlementModeMinimal")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        {mode === "direct" ? te("settlementHintDirect") : te("settlementHintMinimal")}
      </p>
      {mode === "direct"
        ? transfers.map((t) => (
            <div
              key={`${t.from.id}-${t.to.id}-${t.amount}`}
              className="flex items-center gap-2 px-1 py-1.5 text-sm"
            >
              <span>{t.from.name}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span>{t.to.name}</span>
              <span className="ml-auto font-medium">
                {formatCurrency(t.amount, tripCurrency, locale)}
              </span>
            </div>
          ))
        : transfers.map((t) => {
            const payment = findPayment(settlementPayments, t.from.id, t.to.id, t.amount);
            const isChecked = !!payment;
            const canToggle = currentUserId === t.from.id || currentUserId === t.to.id;
            // Only disable the specific item being mutated, not all checkboxes
            const isPending =
              (checkMutation.isPending &&
                checkMutation.variables?.fromUserId === t.from.id &&
                checkMutation.variables?.toUserId === t.to.id &&
                checkMutation.variables?.amount === t.amount) ||
              (uncheckMutation.isPending &&
                uncheckMutation.variables?.fromUserId === t.from.id &&
                uncheckMutation.variables?.toUserId === t.to.id &&
                uncheckMutation.variables?.amount === t.amount);

            return (
              <div
                key={`${t.from.id}-${t.to.id}-${t.amount}`}
                className={`relative flex items-center gap-2 rounded-sm px-1 py-1.5 text-sm select-none ${
                  canToggle
                    ? "has-[:enabled]:hover:bg-muted/80 has-[:enabled]:active:bg-muted transition-colors"
                    : ""
                }`}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => handleToggle(t.from.id, t.to.id, t.amount)}
                  disabled={!canToggle || !!isPending}
                  className="h-4 w-4 before:absolute before:inset-0 before:content-['']"
                />
                <span className={isChecked ? "line-through text-muted-foreground" : ""}>
                  {t.from.name}
                </span>
                <ArrowRight
                  className={`h-3 w-3 shrink-0 ${isChecked ? "text-muted-foreground/50" : "text-muted-foreground"}`}
                />
                <span className={isChecked ? "line-through text-muted-foreground" : ""}>
                  {t.to.name}
                </span>
                <span
                  className={`ml-auto font-medium ${isChecked ? "line-through text-muted-foreground" : ""}`}
                >
                  {formatCurrency(t.amount, tripCurrency, locale)}
                </span>
              </div>
            );
          })}
    </div>
  );
}
