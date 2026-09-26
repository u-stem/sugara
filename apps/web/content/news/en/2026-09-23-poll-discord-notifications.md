---
title: "Date poll start and end are now sent to Discord"
date: "2026-09-23"
summary: "Fixed an issue where \"Date poll started\" and \"Date poll closed\" notifications were not delivered to Discord even when enabled."
---

## Improvements

- Fixed an issue where "Date poll started" and "Date poll closed" events were not sent to your Discord channel even when enabled in Discord Notifications
- "Date poll started" is sent once, when the first member is added to the poll. Adding more members later does not send it again
- "Date poll closed" is sent when the dates are confirmed

As always, please send your feedback from the feedback form in the settings screen.
