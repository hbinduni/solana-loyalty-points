#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
module_dir="server"
cd "$module_dir"
export GOTOOLCHAIN=local
expected=$(awk '$1 == "toolchain" {sub(/^go/, "", $2); print $2; exit}' go.mod)
if [[ -z "$expected" ]]; then
  expected=$(awk '$1 == "go" {print $2; exit}' go.mod)
fi
actual=$(go env GOVERSION)
case "$expected" in
  *.*.*) required="go$expected" ;;
  *) required="go$expected." ;;
esac
if [[ "$required" == *. ]]; then
  [[ "$actual" == "$required"* ]] || { echo "Expected Go $expected.x, found $actual; select the project toolchain first." >&2; exit 1; }
else
  [[ "$actual" == "$required" ]] || { echo "Expected $required, found $actual; select the project toolchain first." >&2; exit 1; }
fi
go version
scanner_bin=$(mktemp -d)
trap 'rm -rf "$scanner_bin"' EXIT
# This release supports the project compiler; local mode prevents silent toolchain switching.
GOBIN="$scanner_bin" go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
go mod download
"$scanner_bin/govulncheck" -show verbose ./...
