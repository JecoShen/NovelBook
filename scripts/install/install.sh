#!/bin/sh
set -eu

INTERACTIVE=false
if [ "$#" -eq 0 ]; then
    if ( : </dev/tty ) 2>/dev/null; then
        INTERACTIVE=true
    else
        echo "NeuroBook Stage 0 无法打开交互终端。自动化安装请显式传参，例如：curl .../install.sh | sh -s -- --profile ghcr --yes" >&2
        exit 1
    fi
fi

HOST_OS="$(uname -s)"
case "$HOST_OS:$(uname -m)" in
    Linux:x86_64|Linux:amd64) BUN_ASSET="bun-linux-x64" ;;
    Linux:aarch64|Linux:arm64) BUN_ASSET="bun-linux-aarch64" ;;
    Darwin:x86_64|Darwin:amd64) BUN_ASSET="bun-darwin-x64" ;;
    Darwin:arm64|Darwin:aarch64) BUN_ASSET="bun-darwin-aarch64" ;;
    *) echo "NeuroBook Manager v1 Stage 0 只支持 Linux/macOS x64或ARM64。" >&2; exit 1 ;;
esac

BUN_VERSION="1.4.2"
MANAGER_TAG="${NEURO_BOOK_MANAGER_TAG:-canary}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
RUNTIME_ROOT="$CACHE_HOME/neuro-book-manager/runtime/bun/$BUN_VERSION"
BUN_BIN="$RUNTIME_ROOT/$BUN_ASSET/bun"
ASSET_URL="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/$BUN_ASSET.zip"

# 各平台/架构对应的archive和bun可执行文件sha256。
case "$BUN_ASSET" in
    bun-linux-x64)
        ARCHIVE_SHA256="36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913"
        BUN_SHA256="a83d263767d839e4d2649ca8e35d07159c7afc99afdc96d731ced29e056dda0c"
        ;;
    bun-linux-aarch64)
        ARCHIVE_SHA256="54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7"
        BUN_SHA256="616f267a34278ff5ac282df37ffdfba1d7141f4f6926bca99af2cd6ef3ad32b1"
        ;;
    bun-darwin-x64)
        ARCHIVE_SHA256="80520d7e17526308c9185d261679ac6d27798d3803a0e9f7ff9121ab8affb012"
        BUN_SHA256="2fa513af22ac59e03aae640cad302e73cb1ddb0f6398501e2ddccf7dcd613596"
        ;;
    bun-darwin-aarch64)
        ARCHIVE_SHA256="90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f"
        BUN_SHA256="35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5"
        ;;
esac

if [ "$HOST_OS" = "Linux" ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    echo "NeuroBook Manager v1 只支持 Linux glibc。" >&2
    exit 1
fi

for required_command in curl unzip awk chmod mktemp; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
        echo "NeuroBook Stage 0 缺少命令：$required_command" >&2
        exit 1
    fi
done
if [ "$HOST_OS" = "Darwin" ]; then
    command -v shasum >/dev/null 2>&1 || { echo "NeuroBook Stage 0 缺少命令：shasum" >&2; exit 1; }
else
    command -v sha256sum >/dev/null 2>&1 || { echo "NeuroBook Stage 0 缺少命令：sha256sum" >&2; exit 1; }
fi

checksum() {
    if [ "$HOST_OS" = "Darwin" ]; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        sha256sum "$1" | awk '{print $1}'
    fi
}

cached_valid=false
downloaded=false
if [ -f "$BUN_BIN" ]; then
    actual_bun="$(checksum "$BUN_BIN")"
    if [ "$actual_bun" = "$BUN_SHA256" ]; then
        chmod 755 "$BUN_BIN"
        actual_version="$($BUN_BIN --version 2>/dev/null || true)"
        if [ -x "$BUN_BIN" ] && [ "$actual_version" = "$BUN_VERSION" ]; then cached_valid=true; fi
    fi
fi

if [ "$cached_valid" != true ]; then
    rm -rf "$RUNTIME_ROOT"
    stage="$(mktemp -d)"
    downloaded=true
    trap 'rm -rf "$stage" "$RUNTIME_ROOT"' EXIT INT TERM
    curl -fsSL "$ASSET_URL" -o "$stage/$BUN_ASSET.zip"
    actual="$(checksum "$stage/$BUN_ASSET.zip")"
    if [ "$actual" != "$ARCHIVE_SHA256" ]; then
        echo "NeuroBook Stage 0 Bun archive checksum不匹配。" >&2
        exit 1
    fi
    mkdir -p "$RUNTIME_ROOT"
    unzip -q "$stage/$BUN_ASSET.zip" -d "$RUNTIME_ROOT"
    chmod 755 "$BUN_BIN"
fi

if [ ! -x "$BUN_BIN" ]; then
    rm -rf "$RUNTIME_ROOT"
    echo "NeuroBook Stage 0 Bun不可执行：$BUN_BIN" >&2
    exit 1
fi
actual_bun="$(checksum "$BUN_BIN")"
actual_version="$($BUN_BIN --version 2>/dev/null || true)"
if [ "$actual_bun" != "$BUN_SHA256" ] || [ "$actual_version" != "$BUN_VERSION" ]; then
    rm -rf "$RUNTIME_ROOT"
    echo "NeuroBook Stage 0 Bun executable校验失败。" >&2
    exit 1
fi
if [ "$downloaded" = true ]; then
    rm -rf "$stage"
    trap - EXIT INT TERM
fi

export NEURO_BOOK_STAGE0_BUN_PATH="$BUN_BIN"
export NEURO_BOOK_STAGE0_BUN_VERSION="$BUN_VERSION"
export NEURO_BOOK_STAGE0_BUN_SOURCE_URL="$ASSET_URL"
export NEURO_BOOK_STAGE0_BUN_ARCHIVE_SHA256="$ARCHIVE_SHA256"
export NEURO_BOOK_STAGE0_BUN_SHA256="$BUN_SHA256"
if [ "$INTERACTIVE" = true ]; then
    exec "$BUN_BIN" x --bun "@notnotype/neuro-book-manager@$MANAGER_TAG" install </dev/tty
fi
exec "$BUN_BIN" x --bun "@notnotype/neuro-book-manager@$MANAGER_TAG" install "$@"
