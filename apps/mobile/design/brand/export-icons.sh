#!/bin/sh
# Writes the launcher icons from the L master (lern-mark.svg). macOS only (sips, swift).
# Run from apps/mobile: sh design/brand/export-icons.sh
set -e
P=$(sed -n 's/.* d="\([^"]*\)".*/\1/p' design/brand/lern-mark.svg)
render=app/assets/icons/render-icons.swift
tmp=$(mktemp -d)
tile() { # out.png px shape(square|round|full) L-height-percent
  s=$(echo "1024*$4/100/256" | bc -l)
  tx=$(echo "(1024-240*$s)/2" | bc -l); ty=$(echo "(1024-256*$s)/2" | bc -l)
  case $3 in
    full) bg='<rect width="1024" height="1024" fill="#171717"/>' ;;
    square) bg='<rect width="1024" height="1024" rx="180" fill="#171717"/>' ;;
    round) bg='<circle cx="512" cy="512" r="512" fill="#171717"/>' ;;
  esac
  printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">%s<path fill="#89F597" transform="translate(%s %s) scale(%s)" d="%s"/></svg>' \
    "$bg" "$tx" "$ty" "$s" "$P" > "$tmp/t.svg"
  swift "$render" "$tmp/t.svg" "$1" "$2"
}
# iOS: one 1024 px opaque icon (the App Store rejects alpha); the system masks the corners.
icon=ios/Lern/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png
tile "$tmp/ios.png" 1024 full 56
sips -s format jpeg -s formatOptions 100 "$tmp/ios.png" --out "$tmp/ios.jpg" >/dev/null
sips -s format png "$tmp/ios.jpg" --out "$icon" >/dev/null
# Android API 26+: adaptive foreground (also the monochrome layer), the L at 44% of the 108 dp canvas.
s=$(echo "108*44/100/256" | bc -l)
cat > android/app/src/main/res/drawable/ic_launcher_foreground.xml <<EOF
<?xml version="1.0" encoding="utf-8"?>
<!-- Written by design/brand/export-icons.sh from lern-mark.svg: the L at 44% of the 108dp canvas, its diagonal fits the 66dp safe circle. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="108dp"
  android:height="108dp"
  android:viewportWidth="108"
  android:viewportHeight="108">
  <group
    android:translateX="$(printf %.2f "$(echo "(108-240*$s)/2" | bc -l)")"
    android:translateY="$(printf %.2f "$(echo "(108-256*$s)/2" | bc -l)")"
    android:scaleX="$(printf %.4f "$s")"
    android:scaleY="$(printf %.4f "$s")">
    <path android:fillColor="#89F597" android:pathData="$P" />
  </group>
</vector>
EOF
# Android API 24-25 (no adaptive icons): legacy PNGs.
for d in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dir=android/app/src/main/res/mipmap-${d%%:*}
  tile "$dir/ic_launcher.png" "${d##*:}" square 56
  tile "$dir/ic_launcher_round.png" "${d##*:}" round 44
done
rm -r "$tmp"
