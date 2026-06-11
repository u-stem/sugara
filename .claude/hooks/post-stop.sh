#!/bin/bash
# Post-stop hook: gate 1 — block Stop if failure-log has unresolved entries.
#                 gate 2 — run tests for packages touched in this session.
# Success: silent (exit 0). Failure: output errors (exit 2).
#
# Full-monorepo `bun run test` on every stop was ~13s for a ~1100-test suite and ran even when
# the model had only edited docs. Opus 4.8 can judge when to run tests itself, so this hook now
# acts as a safety net that only kicks in for packages with staged/unstaged changes.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

LOG_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/failure-log.jsonl"

# failure-log.jsonl is CURRENT state (not append-only history): drop the stale entry for this
# package+category before recording fresh state, so a now-passing package clears its prior
# failure and gate 1 stays accurate. Mirrors post-edit.sh; kept self-contained (no call out to
# the archived claude-settings repo) so the pkg field is always set and prune stays sound.
prune_log() {
  local category="$1" pkg="$2"
  [ -f "$LOG_FILE" ] || return 0
  local tmp
  tmp=$(mktemp)
  if jq -c --arg pkg "$pkg" --arg cat "$category" \
      'select(.pkg != $pkg or .category != $cat)' \
      "$LOG_FILE" > "$tmp" 2>/dev/null; then
    if [ -s "$tmp" ]; then
      mv "$tmp" "$LOG_FILE"
    else
      rm -f "$LOG_FILE"
      rm -f "$tmp"
    fi
  else
    # Malformed JSONL — leave the log untouched so a human can inspect it.
    rm -f "$tmp"
  fi
}

# Self-heal logged test failures before gate 1 evaluates. post-edit.sh only prunes
# check/check-types entries, so a since-fixed test failure has no other prune path and would
# deadlock gate 1: the entry survives every stop, while the permission classifier denies the
# model rm/jq on this log. Pruning happens ONLY after re-running the package's tests and seeing
# them pass, so the gate's audit intent (never stop with a real unresolved failure) is preserved.
if [ "${SUGARA_IGNORE_FAILURE_LOG:-0}" != "1" ] && [ -s "$LOG_FILE" ]; then
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    if bun run --filter "$pkg" test >/dev/null 2>&1; then
      prune_log "test" "$pkg"
    fi
  done < <(jq -r 'select(.category == "test") | .pkg' "$LOG_FILE" 2>/dev/null | sort -u)
fi

# Gate 1: refuse to stop while unresolved lint/type errors are logged. This runs BEFORE the
# test-skip escape (SUGARA_SKIP_POST_STOP_TEST) because that escape is about skipping tests, not
# about ignoring known lint/type failures. Escape hatch for this gate: SUGARA_IGNORE_FAILURE_LOG=1.
if [ "${SUGARA_IGNORE_FAILURE_LOG:-0}" != "1" ] && [ -s "$LOG_FILE" ]; then
  # awk counts records correctly even when the final line lacks a trailing newline;
  # `wc -l` would underreport by 1 in that case and confuse the user.
  count=$(awk 'END{print NR}' "$LOG_FILE")
  cat >&2 <<EOF
[Harness] 未解決の failure が ${count} 件残っています (.claude/failure-log.jsonl)
セッション終了前に以下を実施してください:
  1. 'bun run check && bun run check-types' が zero error で通ることを確認
  2. zero error を確認できたら 'rm .claude/failure-log.jsonl' でクリア
  3. 本当に無視する場合のみ SUGARA_IGNORE_FAILURE_LOG=1 を設定
EOF
  exit 2
fi

# Short-circuit test execution when requested (e.g. long debug sessions, interactive work).
if [ "${SUGARA_SKIP_POST_STOP_TEST:-0}" = "1" ]; then
  exit 0
fi

# Append a fresh failure entry with the same {ts, pkg, category, error} schema post-edit.sh uses.
append_failure() {
  local category="$1" pkg="$2" output_text="$3"
  local first_error
  first_error=$(printf '%s\n' "$output_text" | grep -E '(error|Error|ERROR|FAIL|✗)' | head -1 | sed 's/^[[:space:]]*//')
  if [ -z "$first_error" ]; then
    first_error=$(printf '%s\n' "$output_text" | head -1 | sed 's/^[[:space:]]*//')
  fi
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  mkdir -p "$(dirname "$LOG_FILE")"
  jq -nc \
    --arg ts "$ts" \
    --arg pkg "$pkg" \
    --arg category "$category" \
    --arg error "$first_error" \
    '{ts: $ts, pkg: $pkg, category: $category, error: $error}' \
    >> "$LOG_FILE"
}

# Gate 2: scope tests to packages with staged/unstaged/untracked changes.
changed=$(git status --porcelain 2>/dev/null | awk '{print $2}' || true)
if [ -z "$changed" ]; then
  exit 0
fi

pkgs=()
add_pkg() {
  for existing in "${pkgs[@]:-}"; do
    [ "$existing" = "$1" ] && return
  done
  pkgs+=("$1")
}

while IFS= read -r path; do
  [ -z "$path" ] && continue
  case "$path" in
    apps/web/*)        add_pkg "@sugara/web" ;;
    apps/api/*)        add_pkg "@sugara/api" ;;
    packages/shared/*) add_pkg "@sugara/shared" ;;
  esac
done <<< "$changed"

# No touched packages → nothing to run.
if [ "${#pkgs[@]}" -eq 0 ]; then
  exit 0
fi

# Run tests per package so each failure is attributed to the right pkg in the log (gate 1 keys
# on pkg+category, matching post-edit.sh).
errors=""
for pkg in "${pkgs[@]}"; do
  set +e
  output=$(bun run --filter "$pkg" test 2>&1)
  rc=$?
  set -e
  prune_log "test" "$pkg"
  if [ $rc -ne 0 ]; then
    errors="${errors}${output}\n"
    append_failure "test" "$pkg" "$output"
  fi
done

if [ -n "$errors" ]; then
  printf '%b' "$errors" >&2
  exit 2
fi
