"use client";

import type {
  FriendResponse,
  GroupMemberResponse,
  GroupResponse,
  MemberResponse,
} from "@sugara/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Pencil, UserMinus, UserPlus, Users, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ActionSheet } from "@/components/action-sheet";
import { ItemMenuButton } from "@/components/item-menu-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { UserAvatar } from "@/components/user-avatar";
import { api, getApiErrorMessage } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { ROLE_COLORS } from "@/lib/colors";
import { pageTitle } from "@/lib/constants";
import { QUERY_CONFIG } from "@/lib/query-config";
import { queryKeys } from "@/lib/query-keys";
import { reportError } from "@/lib/report-error";
import { isExpectedClientError } from "@/lib/sentry-options";

export default function SpTripMembersPage() {
  const { id: tripId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const tm = useTranslations("messages");
  const tme = useTranslations("member");
  const tc = useTranslations("common");
  const tf = useTranslations("friend");
  const tlRole = useTranslations("labels.role");

  const [sheetMember, setSheetMember] = useState<MemberResponse | null>(null);
  const [removeMember, setRemoveMember] = useState<MemberResponse | null>(null);
  const [roleChangeMember, setRoleChangeMember] = useState<MemberResponse | null>(null);
  const [adding, setAdding] = useState(false);
  const [userId, setUserId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  useEffect(() => {
    document.title = pageTitle(tme("manageMember"));
  }, [tme]);

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: queryKeys.trips.members(tripId),
    queryFn: () => api<MemberResponse[]>(`/api/trips/${tripId}/members`),
  });

  const currentUserId = session?.user?.id;
  const isOwner = members.some((m) => m.userId === currentUserId && m.role === "owner");

  const { data: friends = [] } = useQuery({
    queryKey: queryKeys.friends.list(),
    queryFn: () => api<FriendResponse[]>("/api/friends"),
    enabled: isOwner,
    ...QUERY_CONFIG.stable,
  });

  const { data: groups = [] } = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: () => api<GroupResponse[]>("/api/groups"),
    enabled: isOwner,
    ...QUERY_CONFIG.stable,
  });

  const { data: groupMembers = [] } = useQuery({
    queryKey: queryKeys.groups.members(selectedGroupId ?? ""),
    queryFn: () => api<GroupMemberResponse[]>(`/api/groups/${selectedGroupId}/members`),
    enabled: selectedGroupId !== null,
    ...QUERY_CONFIG.stable,
  });

  const memberUserIds = new Set(members.map((m) => m.userId));
  const addableFriends = friends.filter((f) => !memberUserIds.has(f.userId));
  const addableGroupMembers = groupMembers.filter((gm) => !memberUserIds.has(gm.userId));

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.trips.members(tripId) });

  async function handleAddById(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = userId.trim();
    if (!trimmed) return;

    setAdding(true);
    try {
      await api(`/api/trips/${tripId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: trimmed, role: "editor" }),
      });
      toast.success(tm("memberAdded"));
      // Already-friends / duplicate request are expected (4xx) and ignored;
      // report anything unexpected to monitoring.
      api("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ addresseeId: trimmed }),
      }).catch((err) => {
        if (!isExpectedClientError(err)) reportError(err);
      });
      setUserId("");
      invalidateMembers();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, tm("memberAddFailed"), {
          badRequest: tm("invalidUserId"),
          notFound: tm("userNotFound"),
          conflict: tm("memberAlready"),
        }),
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleAddFriend(friendUserId: string) {
    setAdding(true);
    try {
      await api(`/api/trips/${tripId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: friendUserId, role: "editor" }),
      });
      toast.success(tm("memberAdded"));
      invalidateMembers();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, tm("memberAddFailed"), {
          conflict: tm("memberAlready"),
        }),
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleAddGroupMembers() {
    const toAdd = addableGroupMembers;
    if (toAdd.length === 0) return;

    setAdding(true);
    const results = await Promise.allSettled(
      toAdd.map((m) =>
        api(`/api/trips/${tripId}/members`, {
          method: "POST",
          body: JSON.stringify({ userId: m.userId, role: "editor" }),
        }),
      ),
    );
    const added = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed === 0) {
      toast.success(tm("groupBulkAdded", { count: added }));
    } else if (added > 0) {
      toast.warning(tm("groupBulkAddPartial", { added, failed }));
    } else {
      toast.error(tm("memberAddFailed"));
    }
    invalidateMembers();
    setAdding(false);
  }

  async function handleRoleChange(memberId: string, newRole: string) {
    const cacheKey = queryKeys.trips.members(tripId);
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<MemberResponse[]>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        prev.map((m) => (m.userId !== memberId ? m : { ...m, role: newRole })),
      );
    }
    toast.success(tm("memberRoleChanged"));
    setRoleChangeMember(null);

    try {
      await api(`/api/trips/${tripId}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      invalidateMembers();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("memberRoleChangeFailed"));
    }
  }

  async function handleRemove(memberId: string) {
    const cacheKey = queryKeys.trips.members(tripId);
    await queryClient.cancelQueries({ queryKey: cacheKey });
    const prev = queryClient.getQueryData<MemberResponse[]>(cacheKey);
    if (prev) {
      queryClient.setQueryData(
        cacheKey,
        prev.filter((m) => m.userId !== memberId),
      );
    }
    toast.success(tm("memberRemoved"));

    try {
      await api(`/api/trips/${tripId}/members/${memberId}`, { method: "DELETE" });
      invalidateMembers();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("memberRemoveFailed"));
    }
  }

  const sheetActions = sheetMember
    ? [
        ...(sheetMember.role !== "owner"
          ? [
              {
                label: tme("changeRole"),
                icon: <Pencil className="h-4 w-4" />,
                onClick: () => {
                  setRoleChangeMember(sheetMember);
                  setSheetMember(null);
                },
              },
            ]
          : []),
        ...(!sheetMember.hasExpenses && sheetMember.role !== "owner"
          ? [
              {
                label: tme("removeMember"),
                icon: <UserMinus className="h-4 w-4" />,
                variant: "destructive" as const,
                onClick: () => {
                  setRemoveMember(sheetMember);
                  setSheetMember(null);
                },
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      {/* Nav bar */}
      <div className="relative mt-2 flex h-10 items-center px-4">
        <Link
          href={`/sp/trips/${tripId}`}
          className="z-10 inline-flex items-center gap-0.5 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="absolute inset-x-16 truncate text-center text-sm font-semibold">
          {tme("title")}
        </span>
      </div>

      <div className="mt-3">
        {/* Add section (owner only) */}
        {isOwner && (
          <div className="px-4">
            {/* Add by ID */}
            <div className="border-b pb-4">
              <form onSubmit={handleAddById} className="flex gap-2">
                <Input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={tme("userIdPlaceholder")}
                  required
                  className="flex-1"
                />
                <Button type="submit" variant="outline" disabled={adding || !userId.trim()}>
                  <UserPlus className="h-4 w-4" />
                  {adding ? "..." : tme("add")}
                </Button>
              </form>
              <p className="mt-1.5 text-sm text-muted-foreground">{tme("addAsEditorHint")}</p>
            </div>

            {/* Friends */}
            {addableFriends.length > 0 && (
              <div className="border-b pb-3">
                <p className="pt-4 pb-2 text-sm font-medium text-muted-foreground">
                  {tme("fromFriendsAdd")}
                </p>
                <div className="divide-y divide-border">
                  {addableFriends.map((friend) => (
                    <div key={friend.friendId} className="flex items-center gap-3 py-2">
                      <UserAvatar
                        name={friend.name}
                        image={friend.image}
                        className="h-8 w-8 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{friend.name}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={adding}
                        onClick={() => handleAddFriend(friend.userId)}
                      >
                        <UserPlus className="h-4 w-4" />
                        {tme("add")}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {friends.length > 0 && addableFriends.length === 0 && (
              <div className="border-b py-4">
                <p className="text-center text-sm text-muted-foreground">{tm("memberAllAdded")}</p>
              </div>
            )}

            {/* Group add */}
            {groups.length > 0 && (
              <div className="border-b pb-4">
                <p className="pt-4 pb-2 text-sm font-medium text-muted-foreground">
                  {tme("fromGroupsAdd")}
                </p>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-sm"
                  onClick={() => setGroupPickerOpen(true)}
                >
                  <span>
                    {selectedGroupId
                      ? groups.find((g) => g.id === selectedGroupId)?.name
                      : tme("selectGroup")}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
                {selectedGroupId && addableGroupMembers.length > 0 && (
                  <div className="mt-2">
                    <div className="divide-y divide-border">
                      {addableGroupMembers.map((gm) => (
                        <div key={gm.userId} className="flex items-center gap-3 py-2">
                          <UserAvatar
                            name={gm.name}
                            image={gm.image}
                            className="h-8 w-8 shrink-0"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">{gm.name}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      className="mt-2 w-full"
                      disabled={adding}
                      onClick={handleAddGroupMembers}
                    >
                      {adding
                        ? tme("addingMember")
                        : tme("addAllCount", { count: addableGroupMembers.length })}
                    </Button>
                  </div>
                )}
                {selectedGroupId && addableGroupMembers.length === 0 && groupMembers.length > 0 && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    {tm("memberAllAdded")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Member list */}
        <div className="pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
          <p className="px-4 pt-4 pb-2 text-sm font-medium text-muted-foreground">
            {tme("memberCount", { count: members.length })}
          </p>
          {membersLoading ? (
            <div className="px-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="ml-auto h-5 w-14 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {members.map((member) => (
                <div key={member.userId} className="flex items-center gap-3 px-4 py-3">
                  <UserAvatar
                    name={member.name}
                    image={member.image}
                    className="h-10 w-10 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{member.name}</span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-xs ${member.role === "owner" ? "" : (ROLE_COLORS[member.role as keyof typeof ROLE_COLORS] ?? "")}`}
                  >
                    {tlRole(member.role)}
                  </Badge>
                  {isOwner && member.role !== "owner" && (
                    <ItemMenuButton
                      ariaLabel={tc("itemMenu", { name: member.name })}
                      onClick={() => setSheetMember(member)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Group picker */}
      <ActionSheet
        open={groupPickerOpen}
        onOpenChange={setGroupPickerOpen}
        actions={groups.map((g) => ({
          label: `${g.name} (${tf("memberCount", { count: g.memberCount })})`,
          icon: <Users className="h-4 w-4" />,
          onClick: () => setSelectedGroupId(g.id),
        }))}
      />

      {/* Member action sheet */}
      <ActionSheet
        open={sheetMember !== null && sheetActions.length > 0}
        onOpenChange={(v) => !v && setSheetMember(null)}
        actions={sheetActions}
      />

      {/* Role change sheet */}
      {roleChangeMember && (
        <ActionSheet
          open={roleChangeMember !== null}
          onOpenChange={(v) => !v && setRoleChangeMember(null)}
          actions={[
            {
              label: tme("changeToEditor"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => handleRoleChange(roleChangeMember.userId, "editor"),
            },
            {
              label: tme("changeToViewer"),
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => handleRoleChange(roleChangeMember.userId, "viewer"),
            },
          ]}
        />
      )}

      {/* Remove confirmation */}
      <ResponsiveAlertDialog
        open={removeMember !== null}
        onOpenChange={(v) => !v && setRemoveMember(null)}
      >
        <ResponsiveAlertDialogContent>
          <ResponsiveAlertDialogHeader>
            <ResponsiveAlertDialogTitle>{tme("deleteConfirmTitle")}</ResponsiveAlertDialogTitle>
            <ResponsiveAlertDialogDescription>
              {tme("deleteConfirmDescription", { name: removeMember?.name ?? "" })}
            </ResponsiveAlertDialogDescription>
          </ResponsiveAlertDialogHeader>
          <ResponsiveAlertDialogFooter>
            <ResponsiveAlertDialogCancel>
              <X className="h-4 w-4" />
              {tc("cancel")}
            </ResponsiveAlertDialogCancel>
            <ResponsiveAlertDialogDestructiveAction
              onClick={() => {
                if (removeMember) handleRemove(removeMember.userId);
                setRemoveMember(null);
              }}
            >
              {tc("deletConfirm")}
            </ResponsiveAlertDialogDestructiveAction>
          </ResponsiveAlertDialogFooter>
        </ResponsiveAlertDialogContent>
      </ResponsiveAlertDialog>
    </>
  );
}
