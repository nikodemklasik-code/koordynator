#!/bin/zsh
cd "$HOME/koordynator" || exit 1

# Update only when the launcher is already on the V5 line and the tree is clean.
# Never switch branches or overwrite local work from a desktop double-click.
current_branch="$(git branch --show-current 2>/dev/null)"
if [ "$current_branch" = "redesign/live-chat-v5" ] && git diff --quiet && git diff --cached --quiet; then
  git pull --ff-only origin redesign/live-chat-v5 >/dev/null 2>&1 || true
fi

# start:all reuses persisted sessions, refreshes live routes, starts Control,
# and opens the workspace. It deliberately never launches fresh vendor OAuth.
exec npm run start:all
