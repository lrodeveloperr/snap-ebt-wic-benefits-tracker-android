#!/usr/bin/env bash
set -euo pipefail

readonly package_name="com.lateefrazaqoyetola.snapebtwictracker.qa"
readonly apk_path="dist/grocery-benefits-tracker-qa.apk"

if [[ ! -f "$apk_path" ]]; then
  echo "QA APK is missing: $apk_path" >&2
  exit 1
fi
if [[ ! "${ANDROID_VERSION_CODE:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo "ANDROID_VERSION_CODE is missing or invalid." >&2
  exit 1
fi

adb devices -l
adb install --no-streaming -r "$apk_path"

installed_path="$(adb shell pm path "$package_name" | tr -d '\r')"
if [[ "$installed_path" != package:* ]]; then
  echo "QA package was not installed: $installed_path" >&2
  exit 1
fi

adb shell dumpsys package "$package_name" \
  | grep -F "versionCode=${ANDROID_VERSION_CODE}"

adb shell am force-stop "$package_name"
adb logcat -c
adb shell monkey -p "$package_name" -c android.intent.category.LAUNCHER 1

app_pid=""
for _attempt in {1..20}; do
  app_pid="$(adb shell pidof "$package_name" | tr -d '\r' | xargs)"
  [[ -n "$app_pid" ]] && break
  sleep 0.5
done

if [[ -z "$app_pid" ]]; then
  echo "QA app did not remain alive after launch." >&2
  adb logcat -d -t 300 >&2
  exit 1
fi

if ! adb shell dumpsys activity activities \
  | grep -E "mResumedActivity|topResumedActivity" \
  | grep -Fq "$package_name"; then
  echo "QA app process is alive but its activity is not resumed." >&2
  adb shell dumpsys activity activities >&2
  adb logcat -d -t 300 >&2
  exit 1
fi

if adb logcat -d -t 500 \
  | grep -E "FATAL EXCEPTION|Process: ${package_name}" \
  | grep -Fq "$package_name"; then
  echo "A fatal exception was recorded during QA launch." >&2
  adb logcat -d -t 500 >&2
  exit 1
fi

echo "QA app installed, launched, resumed, and remained alive (pid $app_pid)."
