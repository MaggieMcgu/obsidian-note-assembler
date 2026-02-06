#!/bin/bash
# Deploy note-assembler to Obsidian vault for testing

VAULT="/Users/maggiemcguire/Library/Mobile Documents/iCloud~md~obsidian/Documents/Braaaaains"
PLUGIN_DIR="$VAULT/.obsidian/plugins/note-assembler"

mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json styles.css "$PLUGIN_DIR/"

echo "Deployed to $PLUGIN_DIR"
echo "In Obsidian: Cmd+R to reload, then enable in Settings → Community Plugins"
