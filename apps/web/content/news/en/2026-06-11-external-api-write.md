---
title: "Create and update via the external API"
date: "2026-06-11"
summary: "The external API (v1) and the MCP server now support creating and updating trips, schedules, expenses, bookmarks, and articles."
---

## New features

### Create and update via the external API

The external API (v1), previously read-only, now supports creating and updating data:

- Create and update trips, and add or update schedules for each day
- Record and update expenses
- Create and update bookmark lists and bookmarks
- Create and update articles

Deletion is still not available through the external API — please use the app for that.

### Write access scopes

When issuing an API key, you can now choose "read" and "create & update" access separately for each data type. Keys that don't need write access can stay read-only.

- Existing keys keep working as read-only. Issue a new key to use write access
- Writing to a shared trip requires the "editor" role or higher in that trip

### Write tools for the MCP server

The MCP server also gained tools for creating and updating data, so AI assistants like Claude can build itineraries and record expenses directly.

The API reference (open `/api/_docs` while logged in) covers the new endpoints as well.

Please send us your feedback from the Settings page.
