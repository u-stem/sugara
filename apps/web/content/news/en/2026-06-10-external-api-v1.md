---
title: "Added external API and API key management"
date: "2026-06-10"
summary: "An external API (v1) for reading your own travel data from scripts or tools, along with API key issuance and management, has been added."
---

## New features

### External API (read-only)

An external API for accessing your travel data from scripts, CLI tools, local LLMs, or other non-browser tools has been added. Read-only access is supported for:

- Trip list and details (including schedules and members)
- Expenses
- Bookmark lists and the bookmarks within them
- Articles you have written

### API key issuance and management

Go to the "API Keys" tab in Settings to issue, list, and delete API keys. When issuing a key, choose an expiry (up to 90 days) and the types of data it can access.

- The raw key is displayed only once at the time of issue — copy and save it somewhere safe, as it cannot be shown again
- Deleting a key revokes it immediately
- Changing or resetting your password revokes all your issued API keys for security
- Guest accounts cannot use this feature

Please send us your feedback from the Settings page.
