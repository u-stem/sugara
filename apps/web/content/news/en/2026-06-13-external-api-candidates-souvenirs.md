---
title: "Candidates and souvenirs in the external API"
date: "2026-06-13"
summary: "The external API (v1) and MCP server now support listing, creating, and updating candidates and souvenirs."
---

## New features

### Manage candidates and souvenirs via the external API

The external API (v1) and the MCP server now support candidates and souvenirs:

- List, create, and update candidates (destinations held before being assigned to a day)
- List, create, and update souvenirs

As before, deletion is not available through the external API — please use the app for that.

### Access scopes

- Candidates use the same "trips" scopes as schedules (`trips:read` / `trips:write`). No new scope is needed
- Souvenirs have a dedicated "souvenirs" scope (`souvenirs:read` / `souvenirs:write`), selectable when issuing an API key
- Creating or updating candidates in a shared trip requires the "editor" role or higher. For souvenirs, any member can add and update their own items

Matching MCP tools (`list_candidates` / `create_candidate` / `update_candidate` / `list_souvenirs` / `create_souvenir` / `update_souvenir`) have been added too. The API reference (open `/api/_docs` while logged in) covers the new endpoints as well.

Please send us your feedback from the Settings page.
