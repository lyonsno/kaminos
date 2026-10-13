#!/bin/sh
# Stands in for a browser executable while tools/test-runner.mjs runs tests.
# Any test that reaches a browser launch lands here: record it and fail.
if [ -n "$KAMINOS_TEST_RUNNER_BROWSER_LOG" ]; then
  printf '%s\t%s\t%s\n' "${KAMINOS_TEST_RUNNER_TEST:-unknown}" "$$" "$*" >> "$KAMINOS_TEST_RUNNER_BROWSER_LOG"
fi
echo "browser launch blocked by tools/test-runner.mjs" >&2
exit 97
