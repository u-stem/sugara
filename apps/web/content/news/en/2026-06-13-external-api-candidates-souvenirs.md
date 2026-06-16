---
title: "Candidates and souvenirs in the external API"
date: "2026-06-13"
summary: "The external API (v1) now supports listing, creating, and updating candidates and souvenirs."
---

## New features

### Manage candidates and souvenirs via the external API

The external API (v1) now supports candidates and souvenirs:

- List, create, and update candidates (destinations held before being assigned to a day)
- List, create, and update souvenirs

As before, deletion is not available through the external API — please use the app for that.

※As of June 2026, deletion is now supported through the external API. See the latest news for details.

### Access scopes

- Candidates use the same "trips" scopes as schedules (`trips:read` / `trips:write`). No new scope is needed
- Souvenirs have a dedicated "souvenirs" scope (`souvenirs:read` / `souvenirs:write`), selectable when issuing an API key
- Creating or updating candidates in a shared trip requires the "editor" role or higher. For souvenirs, any member can add and update their own items

The API reference (open `/api/_docs` while logged in) covers the new endpoints as well.

Please send us your feedback from the Settings page.
