import { Bookmark, FileText, Home, Users } from "lucide-react";

const NAV_LINK_DEFS = [
  { path: "/home", labelKey: "home", icon: Home },
  { path: "/bookmarks", labelKey: "bookmarks", icon: Bookmark },
  { path: "/articles", labelKey: "articles", icon: FileText },
  { path: "/friends", labelKey: "friends", icon: Users },
] as const;

export const NAV_LINKS = NAV_LINK_DEFS.map((l) => ({ ...l, href: l.path })) as {
  path: (typeof NAV_LINK_DEFS)[number]["path"];
  labelKey: (typeof NAV_LINK_DEFS)[number]["labelKey"];
  icon: (typeof NAV_LINK_DEFS)[number]["icon"];
  href: (typeof NAV_LINK_DEFS)[number]["path"];
}[];

export const SP_NAV_LINKS = NAV_LINK_DEFS.map((l) => ({
  ...l,
  href: `/sp${l.path}` as `/sp${(typeof NAV_LINK_DEFS)[number]["path"]}`,
})) as {
  path: (typeof NAV_LINK_DEFS)[number]["path"];
  labelKey: (typeof NAV_LINK_DEFS)[number]["labelKey"];
  icon: (typeof NAV_LINK_DEFS)[number]["icon"];
  href: `/sp${(typeof NAV_LINK_DEFS)[number]["path"]}`;
}[];
