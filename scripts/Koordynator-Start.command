#!/bin/zsh
cd "/Users/nikodem/koordynator" || exit 1
git pull --ff-only origin main >/dev/null 2>&1 || true
npm run start:all
