#!/bin/sh
# Run a noisy command for an agent: one line on a pass, the tail on a failure. Keeps the exit code
# and the full log, so a failure never needs a slow re-run just to see more of the output.
# Usage: sh tools/brief.sh <command...>
log=.superpowers/last-run.log
mkdir -p .superpowers
if "$@" >"$log" 2>&1; then
  # watchman's recrawl notice is local machine noise, not a warning about the code
  echo "PASS: $* ($(grep -i warn "$log" | grep -cviE 'watchman|clear this warning') warning lines, log: $log)"
else
  status=$?
  echo "FAIL ($status): $* (log: $log)"
  tail -n 60 "$log"
  exit "$status"
fi
