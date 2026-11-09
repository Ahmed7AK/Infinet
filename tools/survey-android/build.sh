#!/bin/bash
# Build Infinet Survey (APK) without Gradle: javac → d8 → aapt2 → zipalign → apksigner.
#   tools/survey-android/build.sh            build → tools/survey-android/build/infinet-survey.apk
#   tools/survey-android/build.sh install    build, then install on every phone/emulator adb can see
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
JAR="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)/android.jar"
OUT="$HERE/build"
rm -rf "$OUT/obj" "$OUT/dex" "$OUT"/*.apk
mkdir -p "$OUT/obj" "$OUT/dex"

javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -encoding UTF-8 -d "$OUT/obj" \
  $(find "$HERE/src" -name '*.java')
"$BT/d8" --lib "$JAR" --min-api 29 --release --output "$OUT/dex" $(find "$OUT/obj" -name '*.class')
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest "$HERE/AndroidManifest.xml" -A "$HERE/assets" \
  --min-sdk-version 29 --target-sdk-version 34
(cd "$OUT/dex" && zip -q -j "$OUT/base.apk" classes.dex)
"$BT/zipalign" -p -f 4 "$OUT/base.apk" "$OUT/aligned.apk"

# a fixed key, so a rebuilt APK installs over the old one and the survey on the phone is kept
KS="$HERE/.keystore/survey.jks"
if [ ! -f "$KS" ]; then
  mkdir -p "$HERE/.keystore"
  keytool -genkeypair -keystore "$KS" -storepass infinet -keypass infinet -alias survey -keyalg RSA -keysize 2048 \
    -validity 3650 -dname "CN=Infinet Survey" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:infinet --key-pass pass:infinet --out "$OUT/infinet-survey.apk" "$OUT/aligned.apk"
rm -f "$OUT/base.apk" "$OUT/aligned.apk" "$OUT/infinet-survey.apk.idsig"
echo "Built: $OUT/infinet-survey.apk ($(du -h "$OUT/infinet-survey.apk" | cut -f1))"

if [ "${1:-}" = "install" ]; then
  ADB="$SDK/platform-tools/adb"
  for d in $("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}'); do
    echo "Installing on $d ($("$ADB" -s "$d" shell getprop ro.product.model | tr -d '\r'))"
    "$ADB" -s "$d" install -r -g "$OUT/infinet-survey.apk"
  done
fi
