#!/usr/bin/env bash
set -euo pipefail

# Posts the review verdict to the PR as a single sticky comment (edit-last, else
# create) so repeated pushes update one comment instead of spamming. Best-effort:
# invoked with continue-on-error so a GitHub API hiccup can never flip a real
# PASS to RED. All model-derived text arrives as env or as a JSON file read with
# jq — never interpolated into the shell.
#
# Every attempt overwrites the same execution log, so the log describes the LAST
# attempt that ran. The ladder starts a later slot only while no earlier one
# produced a verdict, so whenever a verdict exists the surviving log belongs to
# that verdict's own attempt — the footer numbers describe the posted verdict.
# A missing or unparsable log costs footer fields, never the post.

pick=""
for pair in "${O1:-}|${OUT1:-}" "${O1R:-}|${OUT1R:-}" "${O2:-}|${OUT2:-}" "${O3:-}|${OUT3:-}"; do
  oc="${pair%%|*}"
  js="${pair#*|}"
  if [ "$oc" = "pass" ] || [ "$oc" = "fail" ]; then
    pick="$js"
    break
  fi
done

model="${MODEL_ARG:-n/a}"
turns="n/a"
tokens_in="n/a"
tokens_out="n/a"
cost="n/a"
have_log=false

exec_log="${EXEC_LOG:-}"
if [ -n "$exec_log" ] && [ -f "$exec_log" ]; then
  # -s tolerates both shapes the CLI may leave behind: a single JSON array of
  # events, or one event per line.
  log_meta="$(jq -rs '
    [ .[] | (if type == "array" then .[] else . end) | select(type == "object") ] as $ev
    | ([ $ev[] | select(.type == "system" and .subtype == "init") ] | last) as $init
    | ([ $ev[] | select(.type == "result") ] | last) as $res
    | [ ($init.model // "" | tostring)
      , ($res.num_turns // "" | tostring)
      , (if $res == null then "" else
          ( ($res.usage.input_tokens // 0)
            + ($res.usage.cache_creation_input_tokens // 0)
            + ($res.usage.cache_read_input_tokens // 0) | tostring ) end)
      , (if $res == null then "" else ($res.usage.output_tokens // 0 | tostring) end)
      , (if ($res.total_cost_usd | type) == "number" then ($res.total_cost_usd | tostring) else "" end)
      ] | join("\u001f")
  ' "$exec_log" 2>/dev/null || true)"
  # \x1f keeps empty fields in place — tab-IFS would collapse them and shift
  # every later value one column left.
  IFS=$'\x1f' read -r log_model log_turns log_in log_out log_cost <<< "$log_meta" || true
  model="${log_model:-$model}"
  turns="${log_turns:-$turns}"
  tokens_in="${log_in:-$tokens_in}"
  tokens_out="${log_out:-$tokens_out}"
  if [ -n "${log_cost:-}" ]; then
    cost="$(printf '$%.2f' "$log_cost" 2>/dev/null || printf 'n/a')"
  fi
  if [ -n "${log_model:-}${log_turns:-}${log_cost:-}" ]; then
    have_log=true
  fi
fi

verdict="UNKNOWN"
mark="❌"
safe="n/a"
scope="n/a"
note=""
summary=""
issues=""

if [ -n "$pick" ]; then
  verdict_meta="$(printf '%s' "$pick" | jq -r '
    if type != "object" then empty else
    [ (.verdict // "UNKNOWN" | tostring)
    , (if (.safe_to_merge | type) == "boolean" then (if .safe_to_merge then "yes" else "no" end) else "n/a" end)
    , (if (.blast_radius | type) == "object" then (.blast_radius.scope // "n/a" | tostring) else "n/a" end)
    , (if (.blast_radius | type) == "object" then (.blast_radius.note // "" | tostring | gsub("[\r\n\t]+"; " ")) else "" end)
    ] | join("\u001f") end
  ' 2>/dev/null || true)"
  if [ -n "$verdict_meta" ]; then
    IFS=$'\x1f' read -r verdict safe scope note <<< "$verdict_meta" || true
  fi
  verdict="${verdict:-UNKNOWN}"
  safe="${safe:-n/a}"
  scope="${scope:-n/a}"
  summary="$(printf '%s' "$pick" | jq -r 'if type == "object" then (.summary // "") else "" end' 2>/dev/null || true)"
  summary="${summary:-_The model returned no summary._}"
  issues="$(printf '%s' "$pick" | jq -r 'if (.blocking_issues | type) == "array" then (.blocking_issues[] | "- " + .) else empty end' 2>/dev/null || true)"
  if [ "$verdict" = "PASS" ]; then
    mark="✅"
  else
    # Fail-closed doctrine: PASS is the only mergeable state, so no other verdict
    # may advertise itself as safe to merge, whatever the model claimed.
    safe="no"
  fi
fi

body_file="$(mktemp)"
{
  printf '%s\n\n' '<!-- ai-review-gate -->'

  if [ -z "$pick" ]; then
    printf '## 🤖 AI review: RED (could not run) ❌\n\n'
    printf 'The gate could not obtain a verdict from any available token slot '
    printf '(rate-limit / auth / network / timeout). Per fail-closed doctrine '
    printf 'this blocks the merge. Re-run the job once capacity returns, or wire '
    printf 'an additional `CLAUDE_CODE_OAUTH_TOKEN_2` / `_3` slot.\n'
  else
    printf '## 🤖 AI review: %s %s\n\n' "$verdict" "$mark"
    if [ -n "$note" ]; then
      printf '**Safe to merge:** %s · **Blast radius:** %s — %s\n' "$safe" "$scope" "$note"
    else
      printf '**Safe to merge:** %s · **Blast radius:** %s\n' "$safe" "$scope"
    fi
    printf '\n### Summary\n\n%s\n' "$summary"
    if [ -n "$issues" ]; then
      printf '\n### Blocking issues\n\n%s\n' "$issues"
    fi
  fi

  if [ -n "$pick" ] || [ "$have_log" = true ]; then
    printf '\n---\n\n'
    printf '<sub>Model `%s` · turns %s · tokens in %s / out %s · ' "$model" "$turns" "$tokens_in" "$tokens_out"
    printf 'API-equivalent cost: %s %s</sub>\n' "$cost" "$mark"
  fi
} > "$body_file"

gh pr comment "$PR" --edit-last --body-file "$body_file" 2>/dev/null \
  || gh pr comment "$PR" --body-file "$body_file"
