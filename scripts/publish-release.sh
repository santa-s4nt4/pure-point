#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Expected a release tag}
archive=${2:?Expected the path to the release ZIP}
: "${GH_REPO:?Expected owner/repository}"
test -s "$archive"
name=$(basename "$archive")
digest="sha256:$(sha256sum "$archive" | cut -d ' ' -f 1)"

publish() {
  local releases release uploaded
  # The authenticated releases list includes drafts left by a previous attempt.
  # A failed lookup must not be treated as permission to create a second release.
  releases=$(gh api --paginate --slurp "repos/$GH_REPO/releases?per_page=100") || return 1
  release=$(jq -c --arg tag "$tag" 'first(.[][] | select(.tag_name == $tag)) // null' <<<"$releases") || return 1
  if [[ "$release" == null ]]; then
    gh release create "$tag" --draft --verify-tag --title "pure-point $tag" --generate-notes || return 1
  fi

  uploaded=$(jq -r --arg name "$name" 'first(.assets[]? | select(.name == $name and .state == "uploaded") | .digest) // ""' <<<"$release") || return 1
  if [[ "$uploaded" != "$digest" ]]; then
    gh release upload "$tag" "$archive" --clobber || return 1
  fi
  if ! jq -e '.draft == false' <<<"$release" >/dev/null; then
    gh release edit "$tag" --draft=false || return 1
  fi
}

# A 502 can arrive after GitHub has already accepted a write. Read the current
# release and asset state again before deciding which operation still needs doing.
for delay in 0 5 15 30 60; do
  if (( delay > 0 )); then
    echo "Retrying release publication in ${delay}s" >&2
    sleep "$delay"
  fi
  if publish; then exit 0; fi
done
echo "Could not publish $tag after five attempts" >&2
exit 1
