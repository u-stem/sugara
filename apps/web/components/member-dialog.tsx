"use client";

import type {
  FriendResponse,
  GroupMemberResponse,
  GroupResponse,
  MemberResponse,
} from "@sugara/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/user-avatar";
import { api, getApiErrorMessage } from "@/lib/api";
import { QUERY_CONFIG } from "@/lib/query-config";
import { queryKeys } from "@/lib/query-keys";
import { reportError } from "@/lib/report-error";
import { isExpectedClientError } from "@/lib/sentry-options";

type MemberDialogProps = {
  tripId: string;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberLimitReached?: boolean;
};

export function MemberDialog({
  tripId,
  isOwner,
  open,
  onOpenChange,
  memberLimitReached,
}: MemberDialogProps) {
  const tm = useTranslations("messages");
  const tme = useTranslations("member");
  const tc = useTranslations("common");
  const tlRole = useTranslations("labels.role");
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("editor");
  const [friendRole, setFriendRole] = useState("editor");
  const [adding, setAdding] = useState(false);
  const [sendFriendRequest, setSendFriendRequest] = useState(true);
  const [removeMember, setRemoveMember] = useState<MemberResponse | null>(null);
  const [groupRole, setGroupRole] = useState("editor");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: queryKeys.trips.members(tripId),
    queryFn: () => api<MemberResponse[]>(`/api/trips/${tripId}/members`),
    enabled: open,
  });

  const { data: friends = [] } = useQuery({
    queryKey: queryKeys.friends.list(),
    queryFn: () => api<FriendResponse[]>("/api/friends"),
    enabled: open,
    ...QUERY_CONFIG.stable,
  });

  const { data: groups = [] } = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: () => api<GroupResponse[]>("/api/groups"),
    enabled: open,
    ...QUERY_CONFIG.stable,
  });

  const { data: groupMembers = [] } = useQuery({
    queryKey: queryKeys.groups.members(selectedGroupId ?? ""),
    queryFn: () => api<GroupMemberResponse[]>(`/api/groups/${selectedGroupId}/members`),
    enabled: open && selectedGroupId !== null,
    ...QUERY_CONFIG.stable,
  });

  const invalidateMembers = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.trips.members(tripId) });

  const memberAddErrorMessage = (err: unknown) =>
    getApiErrorMessage(err, tm("memberAddFailed"), {
      badRequest: tm("invalidUserId"),
      notFound: tm("userNotFound"),
      conflict: tm("memberAlready"),
    });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      await api(`/api/trips/${tripId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId, role }),
      });
      toast.success(tm("memberAdded"));
      if (sendFriendRequest) {
        // Send friend request silently. Already-friends / duplicate are expected
        // (4xx) and ignored; report anything unexpected to monitoring.
        api("/api/friends/requests", {
          method: "POST",
          body: JSON.stringify({ addresseeId: userId }),
        }).catch((err) => {
          if (!isExpectedClientError(err)) reportError(err);
        });
      }
      setUserId("");
      invalidateMembers();
    } catch (err) {
      toast.error(memberAddErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleAddFriend(friendUserId: string) {
    setAdding(true);
    try {
      await api(`/api/trips/${tripId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: friendUserId, role: friendRole }),
      });
      toast.success(tm("memberAdded"));
      invalidateMembers();
    } catch (err) {
      toast.error(memberAddErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleAddGroupMembers() {
    const toAdd = groupMembers.filter((m) => !memberUserIds.has(m.userId));
    if (toAdd.length === 0) return;

    setAdding(true);
    const results = await Promise.allSettled(
      toAdd.map((m) =>
        api(`/api/trips/${tripId}/members`, {
          method: "POST",
          body: JSON.stringify({ userId: m.userId, role: groupRole }),
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
      await api(`/api/trips/${tripId}/members/${memberId}`, {
        method: "DELETE",
      });
      invalidateMembers();
    } catch {
      if (prev) queryClient.setQueryData(cacheKey, prev);
      toast.error(tm("memberRemoveFailed"));
    }
  }

  const memberUserIds = new Set(members.map((m) => m.userId));

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen);
        if (!isOpen) {
          setUserId("");
          setRole("editor");
          setFriendRole("editor");
          setGroupRole("editor");
          setSelectedGroupId(null);
        }
      }}
    >
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{tme("manageMember")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{tme("manageDescription")}</ResponsiveDialogDescription>
          {members.some((m) => m.hasExpenses) && (
            <p className="text-sm text-muted-foreground">{tme("hasExpenseHint")}</p>
          )}
        </ResponsiveDialogHeader>

        <div className="flex min-h-0 flex-col gap-4">
          <LoadingBoundary
            isLoading={membersLoading}
            skeleton={
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="flex flex-1 items-center gap-2">
                      <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    <Skeleton className="h-7 w-[100px]" />
                  </div>
                ))}
              </div>
            }
          >
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "40vh" }}>
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <UserAvatar
                      name={member.name}
                      image={member.image}
                      className="h-6 w-6 shrink-0"
                      fallbackClassName="text-xs"
                    />
                    <p className="truncate text-sm font-medium">{member.name}</p>
                  </div>
                  {member.role === "owner" ? (
                    <span className="shrink-0 select-none text-sm text-muted-foreground">
                      {tlRole("owner")}
                    </span>
                  ) : isOwner ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Select
                        value={member.role}
                        onValueChange={(v) => handleRoleChange(member.userId, v)}
                      >
                        <SelectTrigger className="h-8 w-[100px] text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="editor">{tlRole("editor")}</SelectItem>
                          <SelectItem value="viewer">{tlRole("viewer")}</SelectItem>
                        </SelectContent>
                      </Select>
                      {member.hasExpenses ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-not-allowed select-none text-sm text-muted-foreground/50">
                              {tc("delete")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{tme("cannotDeleteExpense")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <button
                          type="button"
                          className="select-none text-sm text-muted-foreground hover:text-destructive"
                          aria-label={tc("itemMenu", { name: member.name })}
                          onClick={() => setRemoveMember(member)}
                        >
                          {tc("delete")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="shrink-0 select-none text-sm text-muted-foreground">
                      {tlRole(member.role)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </LoadingBoundary>

          {isOwner && (
            <div className="space-y-3 border-t pt-3">
              <Label className="text-sm font-medium">{tme("addMember")}</Label>
              {memberLimitReached ? (
                <p className="text-sm text-muted-foreground">{tm("limitMembers", { max: 20 })}</p>
              ) : (
                <Tabs defaultValue="friends">
                  <TabsList className="w-full">
                    <TabsTrigger value="friends" className="flex-1">
                      {tme("fromFriends")}
                    </TabsTrigger>
                    <TabsTrigger value="groups" className="flex-1">
                      {tme("fromGroups")}
                    </TabsTrigger>
                    <TabsTrigger value="userId" className="flex-1">
                      {tme("byId")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="friends">
                    {(() => {
                      const addable = friends.filter((f) => !memberUserIds.has(f.userId));
                      if (friends.length === 0) {
                        return (
                          <p className="py-4 text-center text-sm text-muted-foreground">
                            {tm("emptyFriend")}
                          </p>
                        );
                      }
                      if (addable.length === 0) {
                        return (
                          <p className="py-4 text-center text-sm text-muted-foreground">
                            {tm("memberAllAdded")}
                          </p>
                        );
                      }
                      return (
                        <div className="space-y-2">
                          <div className="flex select-none items-center justify-end gap-2 py-1">
                            <span className="text-sm text-muted-foreground">{tme("role")}</span>
                            <Select value={friendRole} onValueChange={setFriendRole}>
                              <SelectTrigger className="h-8 w-[100px] text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="editor">{tlRole("editor")}</SelectItem>
                                <SelectItem value="viewer">{tlRole("viewer")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "30vh" }}>
                            {addable.map((friend) => (
                              <div
                                key={friend.friendId}
                                className="flex items-center justify-between gap-2 rounded-md border p-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <UserAvatar
                                    name={friend.name}
                                    image={friend.image}
                                    className="h-6 w-6 shrink-0"
                                    fallbackClassName="text-xs"
                                  />
                                  <p className="truncate text-sm font-medium">{friend.name}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={adding}
                                  onClick={() => handleAddFriend(friend.userId)}
                                >
                                  {tme("add")}
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </TabsContent>

                  <TabsContent value="groups">
                    {groups.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        {tm("emptyGroup")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex select-none items-center justify-between gap-2 py-1">
                          <Select value={selectedGroupId ?? ""} onValueChange={setSelectedGroupId}>
                            <SelectTrigger className="h-8 flex-1 text-sm">
                              <SelectValue placeholder={tme("selectGroup")} />
                            </SelectTrigger>
                            <SelectContent>
                              {groups.map((g) => (
                                <SelectItem key={g.id} value={g.id}>
                                  {g.name} ({g.memberCount})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-sm text-muted-foreground">{tme("role")}</span>
                          <Select value={groupRole} onValueChange={setGroupRole}>
                            <SelectTrigger className="h-8 w-[100px] text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="editor">{tlRole("editor")}</SelectItem>
                              <SelectItem value="viewer">{tlRole("viewer")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {selectedGroupId &&
                          (() => {
                            const addable = groupMembers.filter(
                              (gm) => !memberUserIds.has(gm.userId),
                            );
                            if (addable.length === 0) {
                              return (
                                <p className="py-4 text-center text-sm text-muted-foreground">
                                  {tm("memberAllAdded")}
                                </p>
                              );
                            }
                            return (
                              <>
                                <div
                                  className="space-y-2 overflow-y-auto"
                                  style={{ maxHeight: "25vh" }}
                                >
                                  {addable.map((gm) => (
                                    <div
                                      key={gm.userId}
                                      className="flex items-center justify-between gap-2 rounded-md border p-2"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <UserAvatar
                                          name={gm.name}
                                          image={gm.image}
                                          className="h-6 w-6 shrink-0"
                                          fallbackClassName="text-xs"
                                        />
                                        <p className="truncate text-sm font-medium">{gm.name}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={adding}
                                    onClick={handleAddGroupMembers}
                                  >
                                    {adding ? tme("addingMember") : tme("addAll")}
                                  </Button>
                                </div>
                              </>
                            );
                          })()}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="userId">
                    <form onSubmit={handleAdd} className="space-y-3">
                      <div className="flex select-none items-center justify-end gap-2 py-1">
                        <div className="flex items-center gap-2 me-auto">
                          <Checkbox
                            id="send-friend-request"
                            checked={sendFriendRequest}
                            onCheckedChange={(checked) => setSendFriendRequest(checked === true)}
                          />
                          <Label
                            htmlFor="send-friend-request"
                            className="text-sm text-muted-foreground"
                          >
                            {tme("sendFriendRequest")}
                          </Label>
                        </div>
                        <span className="text-sm text-muted-foreground">{tme("role")}</span>
                        <Select value={role} onValueChange={setRole}>
                          <SelectTrigger className="h-8 w-[100px] text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="editor">{tlRole("editor")}</SelectItem>
                            <SelectItem value="viewer">{tlRole("viewer")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id="member-user-id"
                          name="userId"
                          type="text"
                          placeholder="550e8400-e29b-41d4-..."
                          value={userId}
                          onChange={(e) => setUserId(e.target.value)}
                          required
                          className="flex-1"
                        />
                        <Button type="submit" size="sm" variant="outline" disabled={adding}>
                          <UserPlus className="h-4 w-4" />
                          {adding ? tme("addingMember") : tme("add")}
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{tme("userIdHint")}</p>
                    </form>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
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
    </ResponsiveDialog>
  );
}
