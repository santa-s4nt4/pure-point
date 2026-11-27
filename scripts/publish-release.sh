#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Expected a release tag}
shift
(( $# > 0 )) || exit 1
assets=("$@")
: "${GH_REPO:?Expected owner/repository}"
: "${RELEASE_COMMIT:?Expected the commit used to build the app}"
for asset in "${assets[@]}"; do test -s "$asset"; done
tag_ref=$(jq -rn --arg ref "refs/tags/$tag" '$ref | @uri')

publish() {
  local current releases release uploaded asset name digest
  current=$(gh api "repos/$GH_REPO/commits/$tag_ref" --jq '.sha') || return 1
  if [[ "$current" != "$RELEASE_COMMIT" ]]; then
    echo "Tag $tag points to $current, but the app was built from $RELEASE_COMMIT." >&2
    exit 1
  fi
  # The authenticated releases list includes drafts left by a previous attempt.
  # A failed lookup must not be treated as permission to create a second release.
  releases=$(gh api --paginate --slurp "repos/$GH_REPO/releases?per_page=100") || return 1
  release=$(jq -c --arg tag "$tag" 'first(.[][] | select(.tag_name == $tag)) // null' <<<"$releases") || return 1
  if [[ "$release" == null ]]; then
    gh release create "$tag" --draft --verify-tag --title "pure-point $tag" --generate-notes || return 1
  fi

  for asset in "${assets[@]}"; do
    name=$(basename "$asset")
    digest="sha256:$(sha256sum "$asset" | cut -d ' ' -f 1)"
    uploaded=$(jq -r --arg name "$name" 'first(.assets[]? | select(.name == $name and .state == "uploaded") | .digest) // ""' <<<"$release") || return 1
    if [[ "$uploaded" != "$digest" ]]; then
      gh release upload "$tag" "$asset" --clobber || return 1
    fi
  done
  if ! jq -e '.draft == false' <<<"$release" >/dev/null; then
    gh release edit "$tag" --draft=false || return 1
  fi
}

# A 502 can arrive after GitHub has already accepted a write. Read the current
# release and asset state again before deciding which operation still needs doing.
for delay in 0 5 15 30 60 120 240 480; do
  if (( delay > 0 )); then
    echo "Retrying release publication in ${delay}s" >&2
    sleep "$delay"
  fi
  if publish; then exit 0; fi
done
echo "Could not publish $tag after all retries" >&2
exit 1
