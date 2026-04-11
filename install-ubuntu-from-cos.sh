#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://deep-ai-worker-1253696187.cos.ap-guangzhou.myqcloud.com/latest"
YML_URL="${BASE_URL}/latest.yml"

echo "Reading ${YML_URL} ..."

PKG_NAME="$(
  curl -fsSL "${YML_URL}" \
    | awk '
        /^  - url: / {
          gsub(/^  - url: /, "", $0)
          if ($0 ~ /linux-amd64\.deb$/) {
            print $0
            exit
          }
        }
        /^path: / {
          gsub(/^path: /, "", $0)
          if ($0 ~ /linux-amd64\.deb$/) {
            print $0
            exit
          }
        }
      '
)"

if [[ -z "${PKG_NAME}" ]]; then
  echo "No linux-amd64.deb package found in latest.yml"
  exit 1
fi

TMP_FILE="/tmp/${PKG_NAME}"

echo "Downloading ${PKG_NAME} ..."
curl -fL "${BASE_URL}/${PKG_NAME}" -o "${TMP_FILE}"

echo "Installing ${PKG_NAME} ..."
sudo apt install -y "${TMP_FILE}"

echo "Done."
