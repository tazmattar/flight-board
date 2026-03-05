#!/usr/bin/env bash
# Downloads VATSpy.dat (airport coordinates) into data/navdata/.
# Run once, then copy earth_fix.dat and earth_nav.dat from X-Plane 12/Custom Data/.
set -e

NAVDATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/navdata"
mkdir -p "$NAVDATA_DIR"

echo "Downloading VATSpy.dat..."
curl -L "https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat" \
    -o "$NAVDATA_DIR/VATSpy.dat"

echo "Done. VATSpy.dat saved to $NAVDATA_DIR/VATSpy.dat"
echo ""
echo "Next steps:"
echo "  Copy X-Plane 12/Custom Data/earth_fix.dat → $NAVDATA_DIR/earth_fix.dat"
echo "  Copy X-Plane 12/Custom Data/earth_nav.dat → $NAVDATA_DIR/earth_nav.dat"
echo "  Then: systemctl restart flightboard"
