#!/usr/bin/env bash
# Fills in the release notes of every Ashnote release on the VelosoLabs store whose notes are empty,
# from release-notes/<version>.md (owner's rule: release notes for every version). Runs in GitHub
# Actions with `permissions: id-token: write`: the hub accepts the workflow's own OIDC token for this
# repo on main, so no stored secret is needed (velosolabs docs/store-publishing.md).
set -euo pipefail
HUB="https://velosolabs.com"
TOKEN=$(curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=https://velosolabs.com" | jq -r .value)
curl -fsS "$HUB/api/v1/store/apps/ashnote" | jq -c '.release_notes[] | select((.changelog // "") == "") | {id, version_name}' |
while read -r rel; do
  id=$(jq -r .id <<<"$rel"); ver=$(jq -r .version_name <<<"$rel")
  notes="release-notes/$ver.md"
  if [ -z "$id" ] || [ "$id" = "null" ]; then echo "no id for $ver (the hub may be older than VLABS #274)"; continue; fi
  if [ ! -s "$notes" ]; then echo "::warning::no $notes for store release $ver"; continue; fi
  jq -n --rawfile c "$notes" '{changelog: ($c | rtrimstr("\n"))}' |
    curl -fsS -X POST "$HUB/api/v1/admin/store/ashnote/releases/$id/changelog" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @- > /dev/null
  echo "release notes set for $ver"
done
