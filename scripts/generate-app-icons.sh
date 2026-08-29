#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_directory/.." && pwd)"
source_svg="$repository_root/assets/brand/chelaro-icon.svg"
web_icon="$repository_root/apps/web/src/app/icon.svg"
web_brand_icon="$repository_root/apps/web/public/brand/chelaro-icon.svg"
desktop_assets="$repository_root/apps/desktop/assets"
iconset_root="$(mktemp -d "${TMPDIR:-/tmp}/chelaro-icons.XXXXXX")"
iconset_directory="$iconset_root/Chelaro.iconset"

cleanup() {
  rm -rf "$iconset_root"
}
trap cleanup EXIT

if [[ ! -f "$source_svg" ]]; then
  echo "Missing source icon: $source_svg" >&2
  exit 1
fi

mkdir -p "$(dirname "$web_brand_icon")" "$desktop_assets" "$iconset_directory"
cp "$source_svg" "$web_icon"
cp "$source_svg" "$web_brand_icon"

render_png() {
  local size="$1"
  local output="$2"

  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert --width "$size" --height "$size" "$source_svg" --output "$output"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none "$source_svg" -resize "${size}x${size}" "$output"
  else
    echo "Install rsvg-convert or ImageMagick to generate raster icons." >&2
    exit 1
  fi
}

render_png 1024 "$desktop_assets/icon.png"

render_png 16 "$iconset_directory/icon_16x16.png"
render_png 32 "$iconset_directory/icon_16x16@2x.png"
render_png 32 "$iconset_directory/icon_32x32.png"
render_png 64 "$iconset_directory/icon_32x32@2x.png"
render_png 128 "$iconset_directory/icon_128x128.png"
render_png 256 "$iconset_directory/icon_128x128@2x.png"
render_png 256 "$iconset_directory/icon_256x256.png"
render_png 512 "$iconset_directory/icon_256x256@2x.png"
render_png 512 "$iconset_directory/icon_512x512.png"
render_png 1024 "$iconset_directory/icon_512x512@2x.png"

if command -v iconutil >/dev/null 2>&1; then
  iconutil --convert icns "$iconset_directory" --output "$desktop_assets/icon.icns"
fi

echo "Generated Chelaro web and desktop icons."
