#!/bin/sh
set -eu
if ! grep -Eq '(^|[[:space:]])koordynator($|[[:space:]])' /etc/hosts 2>/dev/null; then
  echo "127.0.0.1 koordynator" | sudo tee -a /etc/hosts >/dev/null
fi
echo "http://koordynator:8787/"
echo "http://koordynator:8787/chat"
echo "http://koordynator:8787/providers"
echo "http://koordynator:8787/releases"
