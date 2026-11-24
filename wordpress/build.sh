#!/bin/bash
# Fabrique le thème : copie le site (v3 + médias) dans motoscool/site, puis le zip
set -e
(cd "$(dirname "$0")/tools" && node build-elementor.mjs)
cd "$(dirname "$0")"; R=..
rm -rf motoscool/site; mkdir -p motoscool/site/assets
cp -r $R/assets/. motoscool/site/assets/
cp -r $R/v3/assets/. motoscool/site/assets/
cp $R/v3/*.html $R/v3/manifest.webmanifest motoscool/site/
cp $R/sitemap.xml motoscool/site/
cp -r $R/v3/services $R/v3/zones motoscool/site/
(cd tools && node build-manifest.mjs)
rm -f motoscool/site/assets/moto-license.txt.bak
rm -f motoscool-theme.zip; mkdir -p /tmp/mczip; rm -f /tmp/mczip/motoscool-theme.zip
/c/Windows/System32/tar.exe -a -cf "$(cygpath -w /tmp/mczip)/motoscool-theme.zip" motoscool && mv -f /tmp/mczip/motoscool-theme.zip motoscool-theme.zip
head -c 2 motoscool-theme.zip | grep -q PK || { echo "ERREUR : archive non zip"; exit 1; }
ls -la motoscool-theme.zip
