#!/usr/bin/env bash
# Builds the road graph compose's osrm service serves: Geofabrik's Cambodia extract, car profile, MLD.
# Runs before every `pnpm infra:up` and does nothing once built; delete infra/docker/osrm/data to rebuild
# from a fresh extract (~40 MB download, a minute or two of processing).
set -euo pipefail
cd "$(dirname "$0")"
[[ -f data/.ready ]] && exit 0

# Same pinned image as the service, so the files match the osrm-routed that reads them
image=$(grep -oE 'ghcr\.io/project-osrm/osrm-backend:[^[:space:]]+' ../compose.yml)
# -latest redirects to a dated file; its .md5 names that file, so download under that name
url=$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://download.geofabrik.de/asia/cambodia-latest.osm.pbf)
file=$(basename "$url")
mkdir -p data
curl -fL --progress-bar -o "data/$file" "$url"
curl -fsS -o "data/$file.md5" "$url.md5"

# shortcut: car profile for every vehicle type; a moto profile (alleys, other speeds) if M4's ETAs look off
docker run --rm -v "$PWD/data:/data" -w /data "$image" bash -euc '
  md5sum -c "$1.md5"
  mv "$1" cambodia.osm.pbf
  osrm-extract -p /opt/car.lua cambodia.osm.pbf
  osrm-partition cambodia.osrm
  osrm-customize cambodia.osrm' _ "$file"
touch data/.ready
