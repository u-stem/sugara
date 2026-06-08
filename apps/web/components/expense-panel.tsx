"use client";

import type { CurrencyCode, ExpenseItem, ExpensesResponse } from "@sugara/shared";
import { formatCurrency } from "@sugara/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/action-sheet";
import { ExpenseDialog } from "@/components/expense-dialog";
import { ItemMenuButton } from "@/components/item-menu-button";
import { SettlementSection } from "@/components/settlement-section";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import {
  ResponsiveAlertDialog,
  ResponsiveAlertDialogCancel,
  ResponsiveAlertDialogContent,
  ResponsiveAlertDialogDescription,
  ResponsiveAlertDialogDestructiveAction,
  ResponsiveAlertDialogFooter,
  ResponsiveAlertDialogHeader,
  ResponsiveAlertDialogTitle,
} from "@/components/ui/responsive-alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiVoid, getApiErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { useMobile } from "@/lib/hooks/use-is-mobile";
import { queryKeys } from "@/lib/query-keys";

type ExpensePanelProps = {
  tripId: string;
  canEdit: boolean;
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
};

export function ExpensePanel({ tripId, canEdit, addOpen, onAddOpenChange }: ExpensePanelProps) {
  const tm = useTranslations("messages");
  const te = useTranslations("expense");
  const tc = useTranslations("common");
  const locale = useLocale();
  const isMobile = useMobile();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.expenses.list(tripId),
    queryFn: () => api<ExpensesResponse>(`/api/trips/${tripId}/expenses`),
  });

  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const dialogOpen = addOpen ?? internalDialogOpen;
  const setDialogOpen = onAddOpenChange ?? setInternalDialogOpen;
  const [editingExpenseItem, setEditingExpenseItem] = useState<ExpenseItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (expenseId: string) =>
      apiVoid(`/api/trips/${tripId}/expenses/${expenseId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.list(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, tm("expenseDeleteFailed")));
    },
  });

  const handleSaved = () => {
    setEditingExpenseItem(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.expenses.list(tripId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.trips.activityLogs(tripId) });
  };

  const handleEdit = (expense: ExpenseItem) => {
    setEditingExpenseItem(expense);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingExpenseItem(null);
    setDialogOpen(true);
  };

  // Fall back per-field (not on `data` as a whole) so a partial response — e.g. an
  // older cached payload without memberTotals — can't surface undefined arrays.
  const tripCurrency = data?.tripCurrency ?? "JPY";
  const expenses = data?.expenses ?? [];
  const settlement = data?.settlement ?? {
    totalAmount: 0,
    balances: [],
    transfers: [],
    directTransfers: [],
  };
  const settlementPayments = data?.settlementPayments ?? [];
  const categoryTotals = data?.categoryTotals ?? [];
  const memberTotals = data?.memberTotals ?? [];

  return (
    <LoadingBoundary
      isLoading={isLoading}
      skeleton={
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
      }
    >
      {isError ? (
        <p className="py-4 text-center text-sm text-destructive">{te("fetchFailed")}</p>
      ) : (
        <div className="space-y-4">
          {/* Toolbar (hidden on mobile where FAB is used) */}
          {canEdit && !isMobile && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleAdd}>
                <Plus className="h-4 w-4" />
                {te("addTitle")}
              </Button>
            </div>
          )}

          {/* Settlement summary */}
          <CollapsiblePrimitive.Root className="rounded-md border bg-muted/50">
            <div className="flex items-center justify-between p-3">
              <span className="text-sm font-medium">{te("totalSpending")}</span>
              <span className="text-sm font-bold">
                {formatCurrency(settlement.totalAmount, tripCurrency, locale)}
              </span>
            </div>
            {(categoryTotals.length > 0 || memberTotals.length > 1) && (
              <>
                <CollapsiblePrimitive.Trigger className="flex w-full items-center gap-1 border-t px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80 transition-colors [&[data-state=open]>svg]:rotate-180">
                  <ChevronDown className="h-3 w-3 transition-transform duration-200" />
                  {te("showDetails")}
                </CollapsiblePrimitive.Trigger>
                <CollapsiblePrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
                  {categoryTotals.length > 0 && (
                    <div className="space-y-1 border-t px-3 pt-2 pb-3">
                      <p className="text-xs text-muted-foreground">{te("byCategory")}</p>
                      {categoryTotals
                        .sort((a, b) => b.total - a.total)
                        .map((ct) => (
                          <div
                            key={ct.category}
                            className="flex items-center justify-between pl-2 text-sm"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                              {ct.label}
                              <span className="text-xs text-muted-foreground">
                                ({te("countSuffix", { count: ct.count })})
                              </span>
                            </span>
                            <span className="font-medium">
                              {formatCurrency(ct.total, tripCurrency, locale)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                  {memberTotals.length > 1 && (
                    <div className="space-y-1 border-t px-3 pt-2 pb-3">
                      <p className="text-xs text-muted-foreground">{te("byMember")}</p>
                      {memberTotals.map((mt) => (
                        <div
                          key={mt.userId}
                          className="flex items-center justify-between pl-2 text-sm"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                            <span translate="yes">{mt.name}</span>
                          </span>
                          <span className="font-medium">
                            {formatCurrency(mt.total, tripCurrency, locale)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsiblePrimitive.Content>
              </>
            )}
            {settlement.totalAmount === 0 && (
              <p className="px-3 pb-3 text-xs text-muted-foreground">{tm("emptyExpense")}</p>
            )}
          </CollapsiblePrimitive.Root>

          {/* Settlement section */}
          {(settlement.transfers.length > 0 || settlement.directTransfers.length > 0) && (
            <SettlementSection
              tripId={tripId}
              settlement={settlement}
              settlementPayments={settlementPayments}
              currentUserId={session?.user?.id}
              tripCurrency={tripCurrency}
            />
          )}

          {/* ExpenseItem list */}
          {expenses.length > 0 && (
            <div className="space-y-2">
              {expenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  tripCurrency={tripCurrency}
                  canEdit={canEdit}
                  isMobile={isMobile}
                  onEdit={handleEdit}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}

          {/* Dialogs */}
          <ExpenseDialog
            tripId={tripId}
            tripCurrency={tripCurrency}
            open={dialogOpen}
            onOpenChange={(open) => {
              if (!open) setEditingExpenseItem(null);
              setDialogOpen(open);
            }}
            expense={editingExpenseItem}
            onSaved={handleSaved}
          />

          <ResponsiveAlertDialog
            open={!!deleteTarget}
            onOpenChange={(v) => !v && setDeleteTarget(null)}
          >
            <ResponsiveAlertDialogContent>
              <ResponsiveAlertDialogHeader>
                <ResponsiveAlertDialogTitle>{te("deleteTitle")}</ResponsiveAlertDialogTitle>
                <ResponsiveAlertDialogDescription>
                  {te("deleteDescription", {
                    title: deleteTarget?.title ?? "",
                    amount: deleteTarget
                      ? formatCurrency(deleteTarget.amount, deleteTarget.currency, locale)
                      : "",
                  })}
                </ResponsiveAlertDialogDescription>
              </ResponsiveAlertDialogHeader>
              <ResponsiveAlertDialogFooter>
                <ResponsiveAlertDialogCancel>
                  <X className="h-4 w-4" />
                  {tc("cancel")}
                </ResponsiveAlertDialogCancel>
                <ResponsiveAlertDialogDestructiveAction
                  onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  {tc("deletConfirm")}
                </ResponsiveAlertDialogDestructiveAction>
              </ResponsiveAlertDialogFooter>
            </ResponsiveAlertDialogContent>
          </ResponsiveAlertDialog>
        </div>
      )}
    </LoadingBoundary>
  );
}

function ExpenseRow({
  expense,
  tripCurrency,
  canEdit,
  isMobile,
  onEdit,
  onDelete,
}: {
  expense: ExpenseItem;
  tripCurrency: CurrencyCode;
  canEdit: boolean;
  isMobile: boolean;
  onEdit: (expense: ExpenseItem) => void;
  onDelete: (expense: ExpenseItem) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const te = useTranslations("expense");
  const tc = useTranslations("common");
  const locale = useLocale();
  const tlExpCat = useTranslations("labels.expenseCategory");
  const tlSplit = useTranslations("labels.splitType");
  const currency = expense.currency ?? ("JPY" as CurrencyCode);

  return (
    <CollapsiblePrimitive.Root className="rounded-md border">
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" translate="yes">
            {expense.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {te("paidBy", { name: expense.paidByUser.name })}
            {" / "}
            {tlSplit(expense.splitType)}
            {expense.category && ` / ${tlExpCat(expense.category)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-bold">
            {formatCurrency(expense.amount, currency, locale)}
            {expense.baseAmount != null && expense.currency !== tripCurrency && (
              <span className="text-muted-foreground">
                {" "}
                ({formatCurrency(expense.baseAmount, tripCurrency, locale)})
              </span>
            )}
          </span>
          {canEdit &&
            (isMobile ? (
              <>
                <ItemMenuButton
                  ariaLabel={te("menuLabel", { title: expense.title })}
                  onClick={() => setSheetOpen(true)}
                />
                <ActionSheet
                  open={sheetOpen}
                  onOpenChange={setSheetOpen}
                  actions={[
                    {
                      label: tc("edit"),
                      icon: <Pencil className="h-4 w-4" />,
                      onClick: () => onEdit(expense),
                    },
                    {
                      label: tc("delete"),
                      icon: <Trash2 className="h-4 w-4" />,
                      onClick: () => onDelete(expense),
                      variant: "destructive" as const,
                    },
                  ]}
                />
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ItemMenuButton ariaLabel={te("menuLabel", { title: expense.title })} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(expense)}>
                    <Pencil /> {tc("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => onDelete(expense)}>
                    <Trash2 /> {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
        </div>
      </div>
      {expense.splits.length > 0 && (
        <>
          <CollapsiblePrimitive.Trigger className="flex w-full items-center gap-1 border-t px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/80 transition-colors [&[data-state=open]>svg]:rotate-180">
            <ChevronDown className="h-3 w-3 transition-transform duration-200" />
            {te("showBreakdown")}
          </CollapsiblePrimitive.Trigger>
          <CollapsiblePrimitive.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
            {expense.lineItems.length > 0 && (
              <div className="space-y-1 border-t px-3 pt-2 pb-3">
                <p className="text-xs text-muted-foreground">{te("lineItemsSection")}</p>
                {expense.lineItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between pl-2 text-sm">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                      <span translate="yes">{item.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({te("memberCount", { count: item.members.length })})
                      </span>
                    </span>
                    <span className="font-medium">
                      {formatCurrency(item.amount, currency, locale)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1 border-t px-3 pt-2 pb-3">
              {expense.lineItems.length > 0 && (
                <p className="text-xs text-muted-foreground">{te("perMemberAmount")}</p>
              )}
              {[...expense.splits]
                .sort((a, b) => b.amount - a.amount)
                .map((split) => {
                  // Equal splits are calculated in base currency; custom/itemized remain in expense currency
                  const splitCurrency = expense.splitType === "equal" ? tripCurrency : currency;
                  return (
                    <div
                      key={split.userId}
                      className="flex items-center justify-between pl-2 text-sm"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                        <span translate="yes">{split.user.name}</span>
                      </span>
                      <span className="font-medium">
                        {formatCurrency(split.amount, splitCurrency, locale)}
                      </span>
                    </div>
                  );
                })}
            </div>
          </CollapsiblePrimitive.Content>
        </>
      )}
    </CollapsiblePrimitive.Root>
  );
}
