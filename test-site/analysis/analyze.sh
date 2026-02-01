#!/bin/bash
# Safe malware analysis script
# Runs in Docker with NO network access

echo "=========================================="
echo "  SAFE MALWARE ANALYSIS CONTAINER"
echo "  Network: DISABLED"
echo "  Filesystem: READ-ONLY"
echo "=========================================="
echo ""

cd /tmp

echo "[1] Copying zip to temp..."
cp /analysis/malware.zip /tmp/

echo "[2] Unzipping..."
unzip -o malware.zip 2>/dev/null

echo ""
echo "[3] Contents:"
find . -type f -name "*" | head -50

echo ""
echo "[4] File types:"
find . -type f -exec file {} \;

echo ""
echo "[5] Looking for JavaScript..."
find . -name "*.js" -o -name "*.html" | while read f; do
  echo "=== $f ==="
  head -100 "$f"
  echo ""
done

echo ""
echo "[6] Looking for URLs/endpoints..."
grep -r "http" . 2>/dev/null | head -50

echo ""
echo "[7] Looking for suspicious patterns..."
grep -rE "(document\.cookie|localStorage|sessionStorage|eval\(|atob\(|fetch\(|XMLHttpRequest)" . 2>/dev/null

echo ""
echo "=========================================="
echo "  ANALYSIS COMPLETE"
echo "=========================================="
