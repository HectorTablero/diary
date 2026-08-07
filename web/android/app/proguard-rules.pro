# R8 rules for the release build.
#
# Most of what matters is already covered by consumer rules inside capacitor-android, which keeps
# every `com.getcapacitor.Plugin` subclass and every @CapacitorPlugin-annotated class whole. That
# is the load-bearing one: the bridge instantiates plugins *by name*, reading the class paths out
# of assets/capacitor.plugins.json, so R8 sees no reference to any of them and would otherwise
# strip the lot.
#
# What follows covers the gaps those rules leave.

# ── Crash reports have to stay readable ───────────────────────────────────────
# Without these, every native stack trace arrives as `a.b.c(:1)`. Renaming the source file
# attribute keeps the line numbers while still dropping the original file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Exception types are matched by name in a few places (and read by humans in reports).
-keepattributes Exceptions,InnerClasses,Signature,EnclosingMethod

# ── The WebView bridge ────────────────────────────────────────────────────────
# @JavascriptInterface methods are called from JS by name and have no Java caller.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Background fetch ──────────────────────────────────────────────────────────
# @transistorsoft/capacitor-background-fetch ships no consumer rules. WorkManager instantiates its
# workers reflectively, and the boot receiver is referenced only from the merged manifest — neither
# is a reference R8 can follow. This is what re-arms periodic sync after a reboot (lib/
# backgroundSync.ts), and its failure mode is silent: sync simply stops happening in the background.
-keep class com.transistorsoft.** { *; }
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class * extends android.content.BroadcastReceiver { *; }

# ── Live updates ──────────────────────────────────────────────────────────────
# @capgo/capacitor-updater persists bundle metadata as JSON and reads it back by field name.
# Stripping or renaming those fields would make the app forget which bundle it is running, which
# is precisely the state the OTA rollback exists to avoid.
-keep class ee.forgr.capacitor_updater.** { *; }
-keep class ee.forgr.capacitor.social.login.** { *; }

# ── Biometrics ────────────────────────────────────────────────────────────────
-keep class androidx.biometric.** { *; }

# ── Google sign-in / credentials ──────────────────────────────────────────────
# Play Services and the Credential Manager use reflection over their own model classes.
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
-keep class androidx.credentials.** { *; }

# Kotlin metadata is read at runtime by several of the above.
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**

# ── Meta's SDK is excluded in build.gradle, not merely unused ─────────────────
# The plugin compiles against its own `facebookStubs` instead. Silence the references those stubs
# leave behind rather than letting them fail the build.
-dontwarn com.facebook.**
