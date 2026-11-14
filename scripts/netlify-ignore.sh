#!/usr/bin/env bash
# Netlify runs this before each build. Exit 0 = skip the deploy, exit 1 = deploy.
# Always deploy the very first build; after that, only when site/ or netlify.toml changed.
if [ -z "$CACHED_COMMIT_REF" ] || [ "$CACHED_COMMIT_REF" = "$COMMIT_REF" ]; then
  exit 1
fi
if git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- site/ netlify.toml; then
  echo "Only non-website files changed — skipping deploy to save credits."
  exit 0
fi
exit 1
