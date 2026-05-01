---
title: Todoist tasks missing
description: Why a Todoist task might not appear in productivity.do
---

# Todoist tasks missing

## Most common causes

### 1. Project filter is active

Symptoms: some tasks visible, others missing.

Fix: Sidebar tasks panel → make sure the project filter is "All projects".
Click the project filter dropdown to clear.

### 2. Token expired

Symptoms: nothing has updated for hours.

Fix: Settings → Integrations → Todoist → "Reconnect". Paste a fresh
Personal Access Token from Todoist Settings → Integrations → Developer.

### 3. Task is in a workspace project, not personal

Symptoms: tasks in a Todoist workspace (team) project don't appear.

Cause: our Todoist integration syncs the same projects you'd see in your
personal Todoist account. Workspace projects sync if you're a member
and the workspace tier permits API access.

### 4. Task is filtered by label/priority

Same as project filter — sidebar group-by tabs filter what's shown.
Click "Date" or "All" to see everything.

### 5. Task was created on Todoist after our last sync

Cause: we sync every 15 minutes by default.

Fix: Settings → Integrations → Todoist → "Sync now" forces an immediate
refresh.

## Sub-tasks

Sub-tasks should appear indented under their parent. If a sub-task
appears at the top level instead, the parent task may be in a hidden
project; making the parent visible should fix the indentation.

## Recurring tasks

Recurring tasks show with a small loop icon. After completion, they
auto-reset to the next occurrence — Todoist's behavior, not ours.

## Completed tasks

Completed tasks aren't returned by default. Toggle "Show completed" in
the task list filter to see them.

## When to contact support

If a specific task is missing after a manual sync, include:
- The task title
- Which Todoist project it's in
- Any due date / labels / priority
