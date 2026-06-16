---
title: "Deletion now supported in the external API"
date: "2026-06-16"
summary: "The external API (v1) now supports deleting schedules, expenses, bookmarks, articles, candidates, and souvenirs."
---

## New features

### The external API now supports deletion

The external API (v1) now supports data deletion:

- Delete schedules, expenses, bookmarks, articles, candidates, and souvenirs

Trip deletion remains available only through the app for security reasons and is not available via the external API.

### Access scopes

- Deletion uses the existing 'create & update' permissions (write scopes). No new scope is needed. The API key issuance screen label has been updated to 'Create, Update & Delete'
- Deleting schedules and expenses in a shared trip requires the 'editor' role or higher. For souvenirs, bookmarks, and articles, any member can delete their own items
- Deletion operations cannot be undone. Deleting non-existent data is silently ignored (idempotent) and does not return an error

The API reference (open `/api/_docs` while logged in) shows the details of each endpoint.

Please send us your feedback from the Settings page.
