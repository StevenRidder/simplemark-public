#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
icon_root="$repo_root/src-tauri/icons/alternates"
generated_root="$icon_root/.generated"

mkdir -p "$icon_root/png"
trap 'rm -rf "$generated_root"' EXIT

for icon_id in original live-layers movable-blocks midnight blue-page; do
  output_dir="$generated_root/$icon_id"
  "$repo_root/node_modules/.bin/tauri" icon \
    --png 1024 \
    --output "$output_dir" \
    "$icon_root/$icon_id.svg"
  cp "$output_dir/1024x1024.png" "$icon_root/png/$icon_id.png"
done
