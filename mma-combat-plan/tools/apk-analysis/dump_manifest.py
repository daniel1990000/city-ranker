"""Decode binary AndroidManifest.xml from an APK path (read-only)."""
from loguru import logger
logger.remove()
import sys
from androguard.core.apk import APK
a = APK(sys.argv[1])
print("package:", a.get_package())
print("app name:", a.get_app_name())
print("versionName:", a.get_androidversion_name(), " versionCode:", a.get_androidversion_code())
print("minSdk:", a.get_min_sdk_version(), " targetSdk:", a.get_target_sdk_version(), " maxSdk:", a.get_max_sdk_version())
print("main activity:", a.get_main_activity())
print("\n-- permissions --"); [print(" ", p) for p in sorted(a.get_permissions())]
print("\n-- activities --"); [print(" ", x) for x in a.get_activities()]
print("\n-- services --"); [print(" ", x) for x in a.get_services()]
print("\n-- receivers --"); [print(" ", x) for x in a.get_receivers()]
print("\n-- providers --"); [print(" ", x) for x in a.get_providers()]
print("\n-- libraries/features --"); [print(" ", x) for x in a.get_libraries()]; [print(" feature:", x) for x in a.get_features()]
