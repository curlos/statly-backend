#!/bin/bash

# Sync Local MongoDB → Atlas M0
# Exports local data and imports to Atlas (overwrites Atlas data)

set -e  # Exit on error

echo "🔄 Syncing Local MongoDB → Atlas M0"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Load environment variables from .env (for Atlas URI)
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
else
    echo -e "${RED}✗${NC} .env file not found"
    exit 1
fi

# Check if ATLAS_URI is set
if [ -z "$ATLAS_URI" ]; then
    echo -e "${RED}✗${NC} ATLAS_URI not found in .env"
    exit 1
fi

# Confirm action
echo -e "${YELLOW}⚠${NC}  WARNING: This will OVERWRITE all data in Atlas M0"
echo "   Atlas URI: $ATLAS_URI"
echo ""
read -p "Continue? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

# Create backup directory
BACKUP_DIR="./mongo-backups/sync-to-atlas-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo ""
echo "📥 Exporting from Local MongoDB..."

# Export from local MongoDB
if mongodump --uri="mongodb://localhost:27017/statly" --out="$BACKUP_DIR" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Data exported from local MongoDB"
else
    echo -e "${RED}✗${NC} Failed to export from local MongoDB"
    echo "   Is MongoDB running? Check: brew services list"
    exit 1
fi

echo ""
echo "📤 Importing to Atlas M0..."

# Import to Atlas M0 (with --drop to overwrite)
if mongorestore --uri="$ATLAS_URI" --drop "$BACKUP_DIR/statly" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Data imported to Atlas M0"
else
    echo -e "${RED}✗${NC} Failed to import to Atlas M0"
    echo "   Check your ATLAS_URI in .env file"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Sync Complete!${NC}"
echo ""
echo "Local MongoDB → Atlas M0 sync successful"
echo "Backup saved to: $BACKUP_DIR"
echo ""
echo "Your Atlas M0 data now matches your local development data"
