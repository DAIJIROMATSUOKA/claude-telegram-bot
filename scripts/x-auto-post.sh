#!/bin/bash
# x-auto-post.sh — Post to X (Twitter) via API v2
# Usage: bash scripts/x-auto-post.sh [--dry-run] "tweet text" [--hashtags "tag1,tag2"]
set -euo pipefail

CONFIG="$HOME/.claude/jarvis_config.json"
DRY_RUN=false
TWEET_TEXT=""
HASHTAGS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --hashtags) HASHTAGS="$2"; shift 2 ;;
    *) TWEET_TEXT="$1"; shift ;;
  esac
done

if [ -z "$TWEET_TEXT" ]; then
  echo "Usage: $0 [--dry-run] \"tweet text\" [--hashtags \"tag1,tag2\"]"
  exit 1
fi

# Append hashtags
if [ -n "$HASHTAGS" ]; then
  IFS=',' read -ra TAGS <<< "$HASHTAGS"
  for tag in "${TAGS[@]}"; do
    tag=$(echo "$tag" | xargs)
    [[ "$tag" == \#* ]] || tag="#$tag"
    TWEET_TEXT="$TWEET_TEXT $tag"
  done
fi

# Check length
CHAR_COUNT=${#TWEET_TEXT}
if [ "$CHAR_COUNT" -gt 280 ]; then
  echo "ERROR: Tweet is $CHAR_COUNT chars (max 280)"
  exit 1
fi

# Read keys from config
if [ ! -f "$CONFIG" ]; then
  echo "ERROR: Config not found at $CONFIG"
  exit 1
fi

API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('x_api_key',''))")
API_SECRET=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('x_api_secret',''))")
ACCESS_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('x_access_token',''))")
ACCESS_SECRET=$(python3 -c "import json; print(json.load(open('$CONFIG')).get('x_access_secret',''))")

if [ -z "$API_KEY" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "ERROR: X API keys not configured in $CONFIG"
  echo "Required: x_api_key, x_api_secret, x_access_token, x_access_secret"
  exit 1
fi

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would post ($CHAR_COUNT chars):"
  echo "$TWEET_TEXT"
  exit 0
fi

# OAuth 1.0a signature (using python3 for HMAC-SHA1)
NONCE=$(python3 -c "import uuid; print(uuid.uuid4().hex)")
TIMESTAMP=$(date +%s)
URL="https://api.twitter.com/2/tweets"

# Build OAuth signature
SIGNATURE=$(python3 -c "
import hmac, hashlib, base64, urllib.parse

method = 'POST'
url = '$URL'
params = {
    'oauth_consumer_key': '$API_KEY',
    'oauth_nonce': '$NONCE',
    'oauth_signature_method': 'HMAC-SHA1',
    'oauth_timestamp': '$TIMESTAMP',
    'oauth_token': '$ACCESS_TOKEN',
    'oauth_version': '1.0'
}
param_str = '&'.join(f'{k}={urllib.parse.quote(v,safe=\"\")}' for k,v in sorted(params.items()))
base_str = f'{method}&{urllib.parse.quote(url,safe=\"\")}&{urllib.parse.quote(param_str,safe=\"\")}'
signing_key = f'{urllib.parse.quote(\"$API_SECRET\",safe=\"\")}&{urllib.parse.quote(\"$ACCESS_SECRET\",safe=\"\")}'
sig = base64.b64encode(hmac.new(signing_key.encode(), base_str.encode(), hashlib.sha1).digest()).decode()
print(sig)
")

AUTH_HEADER="OAuth oauth_consumer_key=\"$API_KEY\",oauth_nonce=\"$NONCE\",oauth_signature=\"$(python3 -c "import urllib.parse; print(urllib.parse.quote('$SIGNATURE',safe=''))")\",oauth_signature_method=\"HMAC-SHA1\",oauth_timestamp=\"$TIMESTAMP\",oauth_token=\"$ACCESS_TOKEN\",oauth_version=\"1.0\""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$URL" \
  -H "Authorization: $AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"text\":$(python3 -c "import json; print(json.dumps('$TWEET_TEXT'))")}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
  TWEET_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])")
  echo "Posted: https://x.com/i/status/$TWEET_ID"
else
  echo "ERROR ($HTTP_CODE): $BODY"
  exit 1
fi
