#!/usr/bin/env python3
"""Protocol smoke test only; replace with your existing agent's launcher."""
import json
import sys

turn = json.load(sys.stdin)
print(json.dumps({
    "protocolVersion": 1,
    "requestId": turn["requestId"],
    "body": "Received your message through the Chief adapter protocol.",
}))
