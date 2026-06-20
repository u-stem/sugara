"use client";

import { type AdminStatsResponse, MAX_TRIP_LIMIT, type WeatherRefreshResult } from "@sugara/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CloudSun,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Save,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy-button";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingBoundary } from "@/components/ui/loading-boundary";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { QUERY_CONFIG } from "@/lib/query-config";
import { queryKeys } from "@/lib/query-keys";

const SUPABASE_MAU_LIMIT = 50_000;
const SUPABASE_DB_SIZE_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function UsageBar({
  label,
  value,
  limit,
  formatValue,
}: {
  label: string;
  value: number;
  limit: number;
  formatValue: (v: number) => string;
}) {
  const pct = Math.min((value / limit) * 100, 100);
  const color = pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-primary";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatValue(value)} / {formatValue(limit)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</p>
    </div>
  );
}

function AnnouncementSection() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data } = useQuery({
    queryKey: queryKeys.admin.announcement(),
    queryFn: () => api<{ message: string | null }>("/api/announcement"),
    ...QUERY_CONFIG.dynamic,
  });

  useEffect(() => {
    if (data !== undefined) {
      setDraft(data.message ?? "");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (message: string) =>
      api<{ message: string | null }>("/api/admin/announcement", {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.admin.announcement(), updated);
      toast.success(updated.message ? "アナウンスを設定しました" : "アナウンスをクリアしました");
    },
    onError: () => toast.error("アナウンスの更新に失敗しました"),
  });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">アナウンス</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          全ユーザーに表示されるバナーメッセージです。空にすると非表示になります。
        </p>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={200}
        rows={3}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="例: メンテナンス中のため一部機能が利用できません"
      />
      <p className="text-right text-xs text-muted-foreground">{draft.length}/200</p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending || !draft}
          onClick={() => save.mutate("")}
        >
          <X className="h-3.5 w-3.5" />
          クリア
        </Button>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(draft)}>
          <Save className="h-3.5 w-3.5" />
          {save.isPending ? "保存中..." : "保存"}
        </Button>
      </div>
    </div>
  );
}

function WeatherRefreshSection() {
  const [result, setResult] = useState<WeatherRefreshResult | null>(null);

  const refresh = useMutation({
    mutationFn: (force: boolean) =>
      api<WeatherRefreshResult>("/api/admin/weather/refresh", {
        method: "POST",
        body: JSON.stringify({ force }),
      }),
    onSuccess: (r) => {
      setResult(r);
      toast.success(
        r.remaining > 0
          ? `天気を更新しました（更新 ${r.updated}件 / 残り ${r.remaining}件）`
          : `天気を更新しました（更新 ${r.updated}件）`,
      );
    },
    onError: () => toast.error("天気の更新に失敗しました"),
  });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">天気データ</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          気象庁の週間天気予報を手動で更新します（通常は1日1回自動更新）。「更新」は未更新の地域のみ、「全件再取得」は全地域を取得します。残りがある場合はもう一度実行してください。
        </p>
      </div>
      {result && (
        <p className="text-xs text-muted-foreground tabular-nums">
          前回: 更新 {result.updated} / スキップ {result.skipped} / 残り {result.remaining} / 全{" "}
          {result.total}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate(true)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          全件再取得
        </Button>
        <Button size="sm" disabled={refresh.isPending} onClick={() => refresh.mutate(false)}>
          <CloudSun className="h-3.5 w-3.5" />
          {refresh.isPending ? "更新中..." : "更新"}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </h2>
      {children}
    </section>
  );
}

type MapsMode = "off" | "admin_only" | "public";

type AdminSettingsResponse = {
  signupEnabled: boolean;
  mapsMode: MapsMode;
};

const MAPS_MODE_LABELS: Record<MapsMode, { label: string; description: string }> = {
  off: { label: "OFF", description: "全旅行で地図を無効化" },
  admin_only: { label: "管理者のみ", description: "管理者作成の旅行のみ地図を有効化" },
  public: { label: "全体公開", description: "全旅行で地図を有効化" },
};

type AdminUser = {
  id: string;
  username: string;
  hasRealEmail: boolean;
  emailVerified: boolean;
  createdAt: string;
  tripCount: number;
  tripLimit: number;
};

type AdminUsersResponse = { users: AdminUser[] };

function AdminSkeleton() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="container flex h-14 items-center gap-3">
          <Skeleton className="h-6 w-6" />
          <Skeleton className="h-4 w-32" />
        </div>
      </header>
      <main className="container max-w-4xl py-8">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="mt-6 space-y-8">
          <div>
            <Skeleton className="h-4 w-20 mb-3" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border bg-card p-4">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="mt-2 h-7 w-12" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="h-4 w-16 mb-3" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-lg border bg-card p-4">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="mt-2 h-7 w-10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "users" | "settings">("overview");
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{
    username: string;
    tempPassword: string;
  } | null>(null);
  const [limitEdit, setLimitEdit] = useState<{
    userId: string;
    username: string;
    value: string;
  } | null>(null);

  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: () => api<AdminStatsResponse>("/api/admin/stats"),
    ...QUERY_CONFIG.static,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return false;
      return failureCount < 3;
    },
  });

  const { data: settings } = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: () => api<AdminSettingsResponse>("/api/admin/settings"),
    ...QUERY_CONFIG.stable,
  });

  const updateSettings = useMutation({
    mutationFn: (patch: Partial<Pick<AdminSettingsResponse, "signupEnabled" | "mapsMode">>) =>
      api<AdminSettingsResponse>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.admin.settings(), updated);
      toast.success("設定を更新しました");
    },
    onError: () => {
      toast.error("設定の変更に失敗しました");
    },
  });

  const { data: usersData } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => api<AdminUsersResponse>("/api/admin/users"),
    ...QUERY_CONFIG.stable,
    retry: false,
    enabled: activeTab === "users",
  });

  const issueTempPassword = useMutation({
    mutationFn: (variables: { userId: string; username: string }) =>
      api<{ tempPassword: string }>(`/api/admin/users/${variables.userId}/temp-password`, {
        method: "POST",
      }),
    onSuccess: (result, variables) => {
      setTempPasswordInfo({ username: variables.username, tempPassword: result.tempPassword });
    },
    onError: () => {
      toast.error("一時パスワードの発行に失敗しました。");
    },
  });

  const updateTripLimit = useMutation({
    mutationFn: (variables: { userId: string; tripLimit: number }) =>
      api<{ tripLimit: number }>(`/api/admin/users/${variables.userId}/trip-limit`, {
        method: "PATCH",
        body: JSON.stringify({ tripLimit: variables.tripLimit }),
      }),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<AdminUsersResponse>(queryKeys.admin.users(), (prev) =>
        prev
          ? {
              users: prev.users.map((u) =>
                u.id === variables.userId ? { ...u, tripLimit: result.tripLimit } : u,
              ),
            }
          : prev,
      );
      setLimitEdit(null);
      toast.success("旅行作成上限を更新しました");
    },
    onError: () => {
      toast.error("上限の更新に失敗しました。");
    },
  });

  const updatedAt = dataUpdatedAt > 0 ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
    notFound();
  }

  return (
    <LoadingBoundary isLoading={isLoading} skeleton={<AdminSkeleton />}>
      <div className="min-h-screen">
        <header className="border-b">
          <div className="container flex h-14 items-center gap-3">
            <Link href="/home">
              <Logo />
            </Link>
            <span className="text-sm font-medium text-muted-foreground">管理ダッシュボード</span>
            {updatedAt && (
              <span className="ml-auto text-xs text-muted-foreground">最終更新: {updatedAt}</span>
            )}
          </div>
        </header>

        <main className="container max-w-4xl py-8">
          {error &&
            !(error instanceof ApiError && (error.status === 403 || error.status === 401)) && (
              <p className="mb-6 text-center text-sm text-destructive">
                エラー: {error instanceof Error ? error.message : "不明なエラー"}
              </p>
            )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="mb-6 w-full">
              <TabsTrigger value="overview" className="flex-1">
                概要
              </TabsTrigger>
              <TabsTrigger value="users" className="flex-1">
                ユーザー管理
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">
                設定
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-8">
              {data && (
                <>
                  <Section title="ユーザー">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <StatCard label="総ユーザー" value={data.users.total} />
                      <StatCard label="ゲスト" value={data.users.guest} />
                      <StatCard label="7日以内 新規" value={data.users.newLast7Days} />
                      <StatCard label="30日以内 新規" value={data.users.newLast30Days} />
                    </div>
                  </Section>

                  <Section title="旅行">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      <StatCard label="総数" value={data.trips.total} />
                      <StatCard label="日程調整" value={data.trips.byStatus.scheduling} />
                      <StatCard label="下書き" value={data.trips.byStatus.draft} />
                      <StatCard label="計画済" value={data.trips.byStatus.planned} />
                      <StatCard label="旅行中" value={data.trips.byStatus.active} />
                      <StatCard label="完了" value={data.trips.byStatus.completed} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      7日以内作成: {data.trips.newLast7Days.toLocaleString()}件
                    </p>
                  </Section>

                  <Section title="コンテンツ">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <StatCard label="スポット" value={data.content.schedules} />
                      <StatCard label="お土産" value={data.content.souvenirs} />
                    </div>
                  </Section>

                  <Section title="無料プラン使用状況">
                    <div className="rounded-lg border bg-card space-y-4 p-5">
                      <UsageBar
                        label="MAU（月間アクティブユーザー）"
                        value={data.supabase.mau}
                        limit={SUPABASE_MAU_LIMIT}
                        formatValue={(v) => v.toLocaleString()}
                      />
                      <UsageBar
                        label="DB サイズ"
                        value={data.supabase.dbSizeBytes}
                        limit={SUPABASE_DB_SIZE_LIMIT_BYTES}
                        formatValue={(v) => `${(v / 1024 / 1024).toFixed(1)} MB`}
                      />
                    </div>
                  </Section>

                  <Section title="Google Maps API">
                    <div className="rounded-lg border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          使用量は Google Cloud Console で確認できます（$200/月 無料枠）
                        </p>
                        <a
                          href="https://console.cloud.google.com/google/maps-apis/metrics"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline shrink-0"
                        >
                          ダッシュボード
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </Section>
                </>
              )}
            </TabsContent>

            <TabsContent value="users">
              {usersData ? (
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2 text-left font-medium">ユーザー名</th>
                        <th className="px-4 py-2 text-left font-medium">登録日</th>
                        <th className="px-4 py-2 text-left font-medium">メール</th>
                        <th className="px-4 py-2 text-left font-medium">旅行数</th>
                        <th className="px-4 py-2 text-left font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersData.users.map((u) => (
                        <tr key={u.id} className="border-b last:border-0">
                          <td className="px-4 py-2">{u.username}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {new Date(u.createdAt).toLocaleDateString("ja-JP")}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant="secondary">
                              {u.hasRealEmail
                                ? u.emailVerified
                                  ? "設定済み"
                                  : "未確認"
                                : "未設定"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 tabular-nums text-muted-foreground">
                            {u.tripCount} / {u.tripLimit}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={issueTempPassword.isPending}
                                onClick={() =>
                                  issueTempPassword.mutate({ userId: u.id, username: u.username })
                                }
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                                {issueTempPassword.isPending ? "発行中..." : "一時PW発行"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setLimitEdit({
                                    userId: u.id,
                                    username: u.username,
                                    value: String(u.tripLimit),
                                  })
                                }
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                上限変更
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <div className="border-b bg-muted/50 px-4 py-2 flex gap-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="border-b last:border-0 px-4 py-2.5 flex items-center gap-4"
                    >
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                      <Skeleton className="h-4 w-10" />
                      <Skeleton className="h-8 w-40 ml-auto rounded-md" />
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              {settings !== undefined && (
                <>
                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-sm">新規利用受付</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {settings.signupEnabled
                            ? "新規アカウントの作成を受け付けています"
                            : "新規アカウントの作成を停止しています"}
                        </p>
                      </div>
                      <Switch
                        checked={settings.signupEnabled}
                        disabled={updateSettings.isPending}
                        onCheckedChange={(checked) =>
                          updateSettings.mutate({ signupEnabled: checked })
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium text-sm">地図機能</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {MAPS_MODE_LABELS[settings.mapsMode].description}
                        </p>
                      </div>
                      <Select
                        value={settings.mapsMode}
                        disabled={updateSettings.isPending}
                        onValueChange={(v) => updateSettings.mutate({ mapsMode: v as MapsMode })}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["off", "admin_only", "public"] as const).map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {MAPS_MODE_LABELS[mode].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </>
              )}
              <AnnouncementSection />
              <WeatherRefreshSection />
            </TabsContent>
          </Tabs>
        </main>

        {tempPasswordInfo && (
          <ResponsiveDialog
            open
            onOpenChange={() => {
              setTempPasswordInfo(null);
            }}
          >
            <ResponsiveDialogContent className="sm:max-w-md">
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>一時パスワードを発行しました</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {tempPasswordInfo.username}{" "}
                  さんの一時パスワードです。このパスワードをユーザーに伝えてください。
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm">
                    {tempPasswordInfo.tempPassword}
                  </code>
                  <CopyButton
                    value={tempPasswordInfo.tempPassword}
                    successMessage="コピーしました"
                    label="パスワードをコピー"
                  />
                </div>
                <p className="text-xs text-destructive">このパスワードは一度しか表示されません。</p>
              </div>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        )}

        {limitEdit && (
          <ResponsiveDialog
            open
            onOpenChange={() => {
              setLimitEdit(null);
            }}
          >
            <ResponsiveDialogContent className="sm:max-w-md">
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>旅行作成上限の変更</ResponsiveDialogTitle>
                <ResponsiveDialogDescription>
                  {limitEdit.username} さんが作成できる旅行の上限件数を設定します。
                </ResponsiveDialogDescription>
              </ResponsiveDialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const parsed = Number(limitEdit.value);
                  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TRIP_LIMIT) {
                    toast.error(`1〜${MAX_TRIP_LIMIT} の整数を入力してください`);
                    return;
                  }
                  updateTripLimit.mutate({ userId: limitEdit.userId, tripLimit: parsed });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="trip-limit">上限件数</Label>
                  <Input
                    id="trip-limit"
                    type="number"
                    min={1}
                    max={MAX_TRIP_LIMIT}
                    value={limitEdit.value}
                    onChange={(e) => setLimitEdit({ ...limitEdit, value: e.target.value })}
                    autoFocus
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={updateTripLimit.isPending}>
                    <Save className="h-3.5 w-3.5" />
                    {updateTripLimit.isPending ? "保存中..." : "保存"}
                  </Button>
                </div>
              </form>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        )}
      </div>
    </LoadingBoundary>
  );
}
