"use client";

import { API_KEY_SCOPES, type ApiKeyScope } from "@sugara/shared";
import { BookOpen, Check, Copy, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, apiVoid } from "@/lib/api";
import { isApiKeyExpired } from "@/lib/api-key-utils";
import { formatDateFromISO } from "@/lib/format";

type ApiKeyItem = {
  id: string;
  name: string;
  start: string;
  scopes: ApiKeyScope[];
  expiresAt: string;
  createdAt: string;
};

type CreatedApiKey = {
  id: string;
  name: string;
  key: string;
  start: string;
  scopes: ApiKeyScope[];
  expiresAt: string;
};

const EXPIRES_OPTIONS = [
  { labelKey: "expires7d", seconds: 7 * 24 * 60 * 60 },
  { labelKey: "expires30d", seconds: 30 * 24 * 60 * 60 },
  { labelKey: "expires90d", seconds: 90 * 24 * 60 * 60 },
] as const;

const DEFAULT_EXPIRES_SECONDS = String(30 * 24 * 60 * 60);

// Maps API key scope identifiers to their i18n label keys.
const SCOPE_LABEL_KEYS = {
  "trips:read": "scopeTrips",
  "expenses:read": "scopeExpenses",
  "articles:read": "scopeArticles",
  "bookmarks:read": "scopeBookmarks",
  "trips:write": "scopeTripsWrite",
  "expenses:write": "scopeExpensesWrite",
  "articles:write": "scopeArticlesWrite",
  "bookmarks:write": "scopeBookmarksWrite",
} as const satisfies Record<ApiKeyScope, string>;

export function ApiKeysSection() {
  const t = useTranslations("apiKeys");
  const tc = useTranslations("common");
  const locale = useLocale();

  // List state
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);

  // Issue form state
  const [name, setName] = useState("");
  const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRES_SECONDS);
  // Least privilege: no scopes preselected — the user must opt in explicitly.
  const [selectedScopes, setSelectedScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Newly created key dialog state
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const data = await api<ApiKeyItem[]>("/api/api-keys");
      setKeys(data);
    } catch {
      // Keep the empty state but surface the failure — otherwise a network
      // error reads as "you have no keys".
      setKeys([]);
      toast.error(t("loadFailed"));
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  function toggleScope(scope: ApiKeyScope) {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
    setScopeError(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selectedScopes.size === 0) {
      setScopeError(t("scopeRequired"));
      return;
    }
    setScopeError(null);
    setSubmitting(true);
    try {
      const created = await api<CreatedApiKey>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          expiresIn: Number(expiresIn),
          scopes: Array.from(selectedScopes),
        }),
      });
      setCreatedKey(created);
      setName("");
      setExpiresIn(DEFAULT_EXPIRES_SECONDS);
      setSelectedScopes(new Set());
    } catch {
      toast.error(t("issueFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleCreatedDialogOpenChange(open: boolean) {
    if (!open) {
      setCreatedKey(null);
      setCopied(false);
      void loadKeys();
    }
  }

  async function handleCopyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
      toast.success(t("copied"));
    } catch {
      // Clipboard API can fail in non-secure contexts; the key stays visible
      // in the dialog for manual copy, but tell the user the button didn't work.
      toast.error(t("copyFailed"));
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    setDeleteLoading(true);
    try {
      await apiVoid(`/api/api-keys/${deletingId}`, { method: "DELETE" });
      setDeletingId(null);
      toast.success(t("deleteSuccess"));
      await loadKeys();
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Issue form */}
      <Card>
        <CardHeader>
          <CardTitle>{t("issueTitle")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
          <a
            href="/api/_docs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <BookOpen className="h-4 w-4" />
            {t("referenceLink")}
          </a>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="api-key-name">
                {t("name")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                required
                maxLength={100}
                disabled={submitting}
              />
            </div>

            {/* Expiry */}
            <div className="space-y-2">
              <Label htmlFor="api-key-expires">{t("expires")}</Label>
              <Select value={expiresIn} onValueChange={setExpiresIn} disabled={submitting}>
                <SelectTrigger id="api-key-expires">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRES_OPTIONS.map((opt) => (
                    <SelectItem key={opt.seconds} value={String(opt.seconds)}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Scopes — fieldset/legend so the group label is announced by screen readers */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium leading-none">{t("scopesLabel")}</legend>
              <div className="space-y-2">
                {API_KEY_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <Checkbox
                      id={`scope-${scope}`}
                      checked={selectedScopes.has(scope)}
                      onCheckedChange={() => toggleScope(scope)}
                      disabled={submitting}
                    />
                    <label htmlFor={`scope-${scope}`} className="cursor-pointer text-sm">
                      {t(SCOPE_LABEL_KEYS[scope])}
                    </label>
                  </div>
                ))}
              </div>
              {scopeError && (
                <p role="alert" className="text-sm text-destructive">
                  {scopeError}
                </p>
              )}
            </fieldset>

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting || name.trim().length === 0}>
                {submitting ? t("issuing") : t("issue")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Newly issued key — shown once, then dismissed */}
      <Dialog open={createdKey !== null} onOpenChange={handleCreatedDialogOpenChange}>
        <DialogContent
          onInteractOutside={(e) => {
            // Prevent accidental close; the key cannot be retrieved again.
            e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("issuedTitle")}</DialogTitle>
            <DialogDescription>{t("issuedDescription")}</DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">
                  {createdKey.key}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void handleCopyKey()}
                  aria-label={tc("copy")}
                  className="shrink-0"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-sm font-medium text-destructive">{t("issuedWarning")}</p>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">{tc("close")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issued key list */}
      <Card>
        <CardHeader>
          <CardTitle>{t("listTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {keysLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{tc("loading")}</p>
          ) : keys.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("listEmpty")}</p>
          ) : (
            <ul className="divide-y">
              {keys.map((key) => {
                const expired = isApiKeyExpired(key.expiresAt);
                return (
                  <li key={key.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{key.name}</span>
                        {expired && <Badge variant="destructive">{t("expired")}</Badge>}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{key.start}&hellip;</p>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {t(SCOPE_LABEL_KEYS[scope])}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t("expires")}: {formatDateFromISO(key.expiresAt, { locale })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingId(key.id)}
                      aria-label={t("deleteAriaLabel", { name: key.name })}
                      className="shrink-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <ResponsiveAlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>{t("deleteConfirmTitle")}</ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              {t("deleteConfirmDescription")}
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel disabled={deleteLoading}>
              {tc("cancel")}
            </ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogDestructiveAction
              disabled={deleteLoading}
              onClick={() => void handleDelete()}
            >
              {t("deleteConfirm")}
            </ResponsiveAlertDialogDestructiveAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>
    </div>
  );
}
