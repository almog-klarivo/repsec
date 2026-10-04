#!/bin/bash
# Helper script for directory HTTP checks
URL="$1"
curl -sS -L -w "\nHTTP_CODE: %{http_code}\n" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "$URL" 2>&1
