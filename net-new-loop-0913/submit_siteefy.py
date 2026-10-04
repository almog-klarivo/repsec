#!/usr/bin/env python3
import urllib.request
import urllib.parse
import json

# Siteefy submit form uses GET request to preview endpoint
url = "https://siteefy.com/submit-tool/preview/generated"
params = {"url": "https://www.klarivo.ai/"}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": "https://siteefy.com/submit-tool"
}

full_url = url + "?" + urllib.parse.urlencode(params)
print(f"Submitting to: {full_url}")

try:
    req = urllib.request.Request(full_url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        status = response.status
        final_url = response.url
        content = response.read().decode('utf-8')
        
        print(f"Status: {status}")
        print(f"Final URL: {final_url}")
        print(f"Content length: {len(content)} bytes")
        
        # Check if we got a preview page
        if "klarivo" in content.lower() or "preview" in content.lower():
            print("\n✓ SUCCESS: Klarivo submission initiated - preview page received")
            with open("evidence/siteefy-submit-response.html", "w") as f:
                f.write(content)
            exit(0)
        else:
            print("\n⚠ Response received but may not be preview page")
            with open("evidence/siteefy-submit-response.html", "w") as f:
                f.write(content)
            exit(1)
except Exception as e:
    print(f"✗ ERROR: {e}")
    exit(2)
