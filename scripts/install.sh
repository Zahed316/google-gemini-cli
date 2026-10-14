#!/usr/bin/env bash
set -e

# Google Gemini CLI Bridge Installer
# Installs 'gemini' and 'gemini-cli' into ~/.local/bin

INSTALL_DIR="${HOME}/.local/bin"
SHARE_DIR="${HOME}/.local/share/gemini-cli"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing Google Gemini CLI..."

mkdir -p "${INSTALL_DIR}"
mkdir -p "${SHARE_DIR}"

# Copy driver and profile manager to shared library directory
cp -f "${REPO_DIR}/src/gemini-driver.js" "${SHARE_DIR}/"
cp -f "${REPO_DIR}/src/profile-manager.js" "${SHARE_DIR}/"

# Symlink executable
ln -sf "${REPO_DIR}/bin/gemini.js" "${INSTALL_DIR}/gemini"
ln -sf "${REPO_DIR}/bin/gemini.js" "${INSTALL_DIR}/gemini-cli"

chmod +x "${INSTALL_DIR}/gemini"
chmod +x "${INSTALL_DIR}/gemini-cli"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  echo ""
  echo "Notice: ${INSTALL_DIR} is not in your PATH."
  echo "Add the following line to your ~/.bashrc or ~/.zshrc:"
  echo '  export PATH="$HOME/.local/bin:$PATH"'
fi

echo ""
echo "==> Installation complete!"
echo "Run 'gemini --help' to get started."
echo "Run 'gemini --list-profiles' to view detected Chrome profiles."
echo "Run 'gemini --login' to authenticate with your Google account."
