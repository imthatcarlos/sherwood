#!/bin/bash
cd "$(dirname "$0")"
echo "Sherwood MM Dashboard running at http://localhost:8420"
python3 -m http.server 8420
