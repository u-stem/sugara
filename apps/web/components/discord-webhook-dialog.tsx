"use client";

import type { DiscordEnabledType } from "@sugara/shared";
import { DISCORD_ENABLED_TYPES_DEFAULT } from "@sugara/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Send, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, getApiErrorMessage } from "@/lib/api";
import { formatDateFromISO } from "@/lib/format";
import { QUERY_CONFIG } from "@/lib/query-config";
import { queryKeys } from "@/lib/query-keys";

type DiscordWebhookDialogProps = {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
};

type WebhookResponse = {
  id: string;
  maskedUrl: string;
  enabledTypes: DiscordEnabledType[];
  isActive: boolean;
  lastSuccessAt: string | null;
  failureCount: number;
};

const TYPE_GROUPS: { labelKey: string; types: DiscordEnabledType[] }[] = [
  { labelKey: "groupMember", types: ["member_added", "member_removed", "role_changed"] },
  {
    labelKey: "groupSchedule",
    types: ["schedule_created", "schedule_updated", "schedule_deleted"],
  },
  { labelKey: "groupPoll", types: ["poll_started", "poll_closed"] },
  { labelKey: "groupExpense", types: ["expense_added", "settlement_checked"] },
  {
    labelKey: "groupCandidate",
    types: ["candidate_created", "candidate_deleted", "candidate_reaction"],
  },
];

const ALL_ENABLED_TYPES: DiscordEnabledType[] = TYPE_GROUPS.flatMap((g) => g.types);

const TYPE_LABEL_KEYS: Record<DiscordEnabledType, string> = {
  member_added: "typeMemberAdded",
  member_removed: "typeMemberRemoved",
  role_changed: "typeRoleChanged",
  schedule_created: "typeScheduleCreated",
  schedule_updated: "typeScheduleUpdated",
  schedule_deleted: "typeScheduleDeleted",
  poll_started: "typePollStarted",
  poll_closed: "typePollClosed",
  expense_added: "typeExpenseAdded",
  settlement_checked: "typeSettlementChecked",
  candidate_created: "typeCandidateCreated",
  candidate_deleted: "typeCandidateDeleted",
  candidate_reaction: "typeCandidateReaction",
};

export function DiscordWebhookDialog({
  tripId,
  open,
  onOpenChange,
  canEdit: canEditProp,
}: DiscordWebhookDialogProps) {
  const locale = useLocale();
  const td = useTranslations("discord");
  const queryClient = useQueryClient();
  const cacheKey = queryKeys.discord.webhook(tripId);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<DiscordEnabledType[]>(
    DISCORD_ENABLED_TYPES_DEFAULT,
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const {
    data: webhook,
    isLoading,
    error,
  } = useQuery({
    queryKey: cacheKey,
    queryFn: async () => {
      const result = await api<WebhookResponse | null>(`/api/trips/${tripId}/discord-webhook`);
      return result;
    },
    enabled: open,
    ...QUERY_CONFIG.stable,
  });

  // Sync form state when webhook data loads
  useEffect(() => {
    if (webhook) {
      setWebhookUrl("");
      setEnabledTypes(webhook.enabledTypes);
    } else {
      setWebhookUrl("");
      setEnabledTypes(DISCORD_ENABLED_TYPES_DEFAULT);
    }
  }, [webhook]);

  function toggleType(type: DiscordEnabledType) {
    setEnabledTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim()) {
      toast.error(td("invalidUrl"));
      return;
    }
    setSaving(true);
    try {
      await api(`/api/trips/${tripId}/discord-webhook`, {
        method: "POST",
        body: JSON.stringify({
          webhookUrl,
          enabledTypes,
          locale,
        }),
      });
      toast.success(td("created"));
      queryClient.invalidateQueries({ queryKey: cacheKey });
      onOpenChange(false);
    } catch (err) {
      const message = getApiErrorMessage(err, td("saveFailed"), {
        conflict: td("alreadyExists"),
        badRequest: td("unreachableUrl"),
      });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { enabledTypes, locale };
      if (webhookUrl.trim()) {
        body.webhookUrl = webhookUrl;
      }
      await api(`/api/trips/${tripId}/discord-webhook`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      toast.success(td("updated"));
      queryClient.invalidateQueries({ queryKey: cacheKey });
      onOpenChange(false);
    } catch (err) {
      const message = getApiErrorMessage(err, td("updateFailed"), {
        badRequest: td("unreachableUrl"),
      });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!webhook || toggling) return;
    setToggling(true);
    const newIsActive = !webhook.isActive;
    // Optimistic update to avoid flicker
    queryClient.setQueryData(cacheKey, { ...webhook, isActive: newIsActive });
    try {
      await api(`/api/trips/${tripId}/discord-webhook`, {
        method: "PUT",
        body: JSON.stringify({ isActive: newIsActive }),
      });
      toast.success(td("updated"));
      queryClient.invalidateQueries({ queryKey: cacheKey });
    } catch (err) {
      // Revert on failure
      queryClient.setQueryData(cacheKey, webhook);
      const message = getApiErrorMessage(err, td("updateFailed"));
      toast.error(message);
    } finally {
      setToggling(false);
    }
  }

  async function handleTestSend() {
    setTesting(true);
    try {
      await api(`/api/trips/${tripId}/discord-webhook/test`, {
        method: "POST",
      });
      toast.success(td("testSendSuccess"));
    } catch (err) {
      const message = getApiErrorMessage(err, td("unreachableUrl"));
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  const hasChanges =
    webhook &&
    (webhookUrl.trim() !== "" ||
      enabledTypes.length !== webhook.enabledTypes.length ||
      enabledTypes.some((t) => !webhook.enabledTypes.includes(t)));

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-2">
            <ResponsiveDialogTitle>{td("title")}</ResponsiveDialogTitle>
            {webhook && (
              <Badge
                variant={webhook.isActive ? "default" : "secondary"}
                className="pointer-events-none"
              >
                {webhook.isActive ? td("active") : td("inactive")}
              </Badge>
            )}
          </div>
          <ResponsiveDialogDescription>{td("description")}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <LoadingBoundary
          isLoading={isLoading}
          skeleton={
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            </div>
          }
        >
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error instanceof Error ? error.message : String(error)}
            </p>
          ) : webhook ? (
            <ExistingWebhookView
              webhook={webhook}
              canEdit={canEditProp}
              locale={locale}
              webhookUrl={webhookUrl}
              enabledTypes={enabledTypes}
              saving={saving}
              testing={testing}
              toggling={toggling}
              hasChanges={!!hasChanges}
              td={td}
              onWebhookUrlChange={setWebhookUrl}
              onToggleType={toggleType}
              onSetAll={setEnabledTypes}
              onUpdate={handleUpdate}
              onTestSend={handleTestSend}
              onToggleActive={handleToggleActive}
            />
          ) : (
            canEditProp && (
              <CreateWebhookForm
                webhookUrl={webhookUrl}
                enabledTypes={enabledTypes}
                saving={saving}
                td={td}
                onWebhookUrlChange={setWebhookUrl}
                onToggleType={toggleType}
                onSetAll={setEnabledTypes}
                onCreate={handleCreate}
              />
            )
          )}
        </LoadingBoundary>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// --- Sub-components ---

type TypeToggleListProps = {
  enabledTypes: DiscordEnabledType[];
  onToggleType: (type: DiscordEnabledType) => void;
  onSetAll: (types: DiscordEnabledType[]) => void;
  disabled: boolean;
  td: ReturnType<typeof useTranslations<"discord">>;
};

function TypeToggleList({
  enabledTypes,
  onToggleType,
  onSetAll,
  disabled,
  td,
}: TypeToggleListProps) {
  const allSelected = ALL_ENABLED_TYPES.every((t) => enabledTypes.includes(t));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>
          {td("enabledTypes")} <span className="text-destructive">*</span>
        </Label>
        {!disabled && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => onSetAll(allSelected ? [] : [...ALL_ENABLED_TYPES])}
          >
            {allSelected ? td("deselectAll") : td("selectAll")}
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {TYPE_GROUPS.map((group) => (
          <div key={group.labelKey}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {td(group.labelKey as Parameters<typeof td>[0])}
            </p>
            <div className="space-y-1">
              {group.types.map((type) => (
                <div
                  key={type}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 rounded-lg px-1 py-1.5"
                >
                  <Label htmlFor={`type-${type}`} className="text-sm">
                    {td(TYPE_LABEL_KEYS[type] as Parameters<typeof td>[0])}
                  </Label>
                  <Switch
                    id={`type-${type}`}
                    checked={enabledTypes.includes(type)}
                    onCheckedChange={() => onToggleType(type)}
                    disabled={disabled}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type CreateWebhookFormProps = {
  webhookUrl: string;
  enabledTypes: DiscordEnabledType[];
  saving: boolean;
  td: ReturnType<typeof useTranslations<"discord">>;
  onWebhookUrlChange: (url: string) => void;
  onToggleType: (type: DiscordEnabledType) => void;
  onSetAll: (types: DiscordEnabledType[]) => void;
  onCreate: (e: React.FormEvent) => void;
};

function CreateWebhookForm({
  webhookUrl,
  enabledTypes,
  saving,
  td,
  onWebhookUrlChange,
  onToggleType,
  onSetAll,
  onCreate,
}: CreateWebhookFormProps) {
  const tc = useTranslations("common");
  return (
    <form onSubmit={onCreate} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="webhook-url">
          {td("webhookUrl")} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="webhook-url"
          type="url"
          placeholder={td("webhookUrlPlaceholder")}
          value={webhookUrl}
          onChange={(e) => onWebhookUrlChange(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">{td("webhookUrlHelp")}</p>
      </div>

      <TypeToggleList
        enabledTypes={enabledTypes}
        onToggleType={onToggleType}
        onSetAll={onSetAll}
        disabled={saving}
        td={td}
      />

      <ResponsiveDialogFooter>
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline">
            <X className="h-4 w-4" />
            {tc("cancel")}
          </Button>
        </ResponsiveDialogClose>
        <Button type="submit" disabled={saving || enabledTypes.length === 0}>
          <Check className="h-4 w-4" />
          {td("save")}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

type ExistingWebhookViewProps = {
  webhook: WebhookResponse;
  canEdit: boolean;
  locale: string;
  webhookUrl: string;
  enabledTypes: DiscordEnabledType[];
  saving: boolean;
  testing: boolean;
  toggling: boolean;
  hasChanges: boolean;
  td: ReturnType<typeof useTranslations<"discord">>;
  onWebhookUrlChange: (url: string) => void;
  onToggleType: (type: DiscordEnabledType) => void;
  onSetAll: (types: DiscordEnabledType[]) => void;
  onUpdate: () => void;
  onTestSend: () => void;
  onToggleActive: () => void;
};

function ExistingWebhookView({
  webhook,
  canEdit,
  locale,
  webhookUrl,
  enabledTypes,
  saving,
  testing,
  toggling,
  hasChanges,
  td,
  onWebhookUrlChange,
  onToggleType,
  onSetAll,
  onUpdate,
  onTestSend,
  onToggleActive,
}: ExistingWebhookViewProps) {
  const tc = useTranslations("common");

  return (
    <div className="space-y-4">
      {/* Active toggle */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <Switch
            id="webhook-active"
            checked={webhook.isActive}
            onCheckedChange={onToggleActive}
            disabled={toggling}
          />
          <Label htmlFor="webhook-active" className="text-sm">
            {webhook.isActive ? td("active") : td("inactive")}
          </Label>
        </div>
      )}

      {/* Webhook URL + test send */}
      {canEdit ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="edit-webhook-url">{td("webhookUrl")}</Label>
            <p className="mt-1 text-xs text-muted-foreground">{td("webhookUrlChangeHelp")}</p>
          </div>
          <div className="flex gap-2">
            <Input
              id="edit-webhook-url"
              type="url"
              placeholder={webhook.maskedUrl}
              value={webhookUrl}
              onChange={(e) => onWebhookUrlChange(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={testing || !webhook.isActive}
              onClick={onTestSend}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
              {td("testSend")}
            </Button>
          </div>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">{webhook.maskedUrl}</span>
      )}

      {/* Last success */}
      {webhook.lastSuccessAt && (
        <p className="text-xs text-muted-foreground">
          {td("lastSuccess")}: {formatDateFromISO(webhook.lastSuccessAt, { locale })}
        </p>
      )}

      {/* Enabled types */}
      <TypeToggleList
        enabledTypes={enabledTypes}
        onToggleType={onToggleType}
        onSetAll={onSetAll}
        disabled={!canEdit || saving}
        td={td}
      />

      {/* Footer: cancel + save */}
      {canEdit && (
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">
              <X className="h-4 w-4" />
              {tc("cancel")}
            </Button>
          </ResponsiveDialogClose>
          <Button disabled={saving || !hasChanges || enabledTypes.length === 0} onClick={onUpdate}>
            <Check className="h-4 w-4" />
            {td("save")}
          </Button>
        </ResponsiveDialogFooter>
      )}
    </div>
  );
}
