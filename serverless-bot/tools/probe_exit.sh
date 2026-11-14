#!/usr/bin/env bash
# Run ON an exit server (the machine whose IP customers appear from). It tests which services that IP can reach and reports it to the payment relay,
# so the bot can choose the best server for each use. Nothing about customers is read or sent. Example (every 6 hours):
#   0 */6 * * * RELAY_URL=https://pay.theownlypwcha.top RELAY_KEY=<relay key> bash /root/probe_exit.sh DE exit-de
# usage: probe_exit.sh <COUNTRY_CODE> [node-label]       (the relay key is read from the RELAY_KEY environment variable — never write it in a file in a repository)
set -u
CC="${1:?usage: probe_exit.sh DE|NL|PL|FI|US [node]}"; NODE="${2:-}"
: "${RELAY_URL:?set RELAY_URL}"; : "${RELAY_KEY:?set RELAY_KEY}"
check() { # name url -> ok | blocked | down | other
  local code; code=$(curl -s -o /dev/null -m 12 -w '%{http_code}' -A 'Mozilla/5.0' "$2" || true)
  case "$code" in 2*|3*) echo ok ;; 000) echo down ;; 403|451) echo blocked ;; *) echo other ;; esac
}
declare -A R
R[claude]=$(check claude https://claude.ai/)
R[chatgpt]=$(check chatgpt https://chatgpt.com/)
R[youtube]=$(check youtube https://www.youtube.com/)
R[instagram]=$(check instagram https://www.instagram.com/)
R[telegram]=$(check telegram https://web.telegram.org/)
R[google]=$(check google https://www.google.com/)
R[github]=$(check github https://github.com/)
R[netflix]=$(check netflix https://www.netflix.com/)
JSON="{\"country\":\"$CC\",\"node\":\"$NODE\",\"results\":{"; first=1
for k in "${!R[@]}"; do [ $first = 1 ] || JSON+=","; JSON+="\"$k\":\"${R[$k]}\""; first=0; done; JSON+="}}"
echo "$JSON"
curl -s -m 20 -X POST "$RELAY_URL/probe" -H "X-Relay-Key: $RELAY_KEY" -H 'Content-Type: application/json' -d "$JSON"; echo
