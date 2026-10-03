#!/usr/bin/env bash
# Print the path to a d2 binary. Uses a system d2 if present, otherwise
# downloads the latest release into /tmp (no system install).
set -euo pipefail

if command -v d2 >/dev/null 2>&1; then
	command -v d2
	exit 0
fi

existing=$(ls -d /tmp/d2-v*/bin/d2 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$existing" ] && [ -x "$existing" ]; then
	echo "$existing"
	exit 0
fi

case "$(uname -s)" in
	Linux) os=linux ;;
	Darwin) os=macos ;;
	*) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
	x86_64 | amd64) arch=amd64 ;;
	arm64 | aarch64) arch=arm64 ;;
	*) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

version=$(curl -fsSL https://api.github.com/repos/terrastruct/d2/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)
tarball="/tmp/d2-$version.tar.gz"
curl -fsSL -o "$tarball" "https://github.com/terrastruct/d2/releases/download/$version/d2-$version-$os-$arch.tar.gz"
tar xzf "$tarball" -C /tmp
rm -f "$tarball"
echo "/tmp/d2-$version/bin/d2"
