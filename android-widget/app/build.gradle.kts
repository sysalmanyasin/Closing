import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Local, git-ignored file for the widget-service account's password so it
// never gets committed to this public repo. Create android-widget/local.properties
// with a line: widgetServicePassword=<the password you set in Supabase Auth>
// CI instead supplies it via -PwidgetServicePassword from a GitHub Actions secret.
val localProperties = Properties().apply {
    val localFile = rootProject.file("local.properties")
    if (localFile.exists()) {
        localFile.inputStream().use { load(it) }
    }
}
val widgetServicePassword: String =
    (project.findProperty("widgetServicePassword") as String?)
        ?: localProperties.getProperty("widgetServicePassword")
        ?: ""

android {
    namespace = "com.duapharma.closingwidget"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.duapharma.closingwidget"
        minSdk = 24
        targetSdk = 34
        // Bumped per CI build via -PappVersionCode=<github.run_number> so the
        // Android package installer always sees a newer version and offers a
        // clean update rather than "not installed" — see build-widget-apk.yml.
        versionCode = (project.findProperty("appVersionCode") as String?)?.toIntOrNull() ?: 1
        versionName = "1.0.$versionCode"

        // Public anon/publishable key — safe to ship in a client app.
        // Table reads are gated by Supabase RLS policy (is_widget_service()),
        // not by keeping this key secret.
        buildConfigField("String", "SUPABASE_URL", "\"https://wetbugzzchkghpzmowod.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndldGJ1Z3p6Y2hrZ2hwem1vd29kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMDg4OTIsImV4cCI6MjA5Nzg4NDg5Mn0.LXFrvQTOfI3ph4aA8xWYIUo-z1yxdX0znnN5f-KsOPM\"")

        // Credential for the dedicated, read-only "widget service" Supabase
        // Auth account (see bt_widget_service_accounts / is_widget_service()).
        // Used only once per device to sign in and obtain a refresh token —
        // see WidgetAuthManager.kt. Never hardcode the real password here;
        // it's injected via local.properties (dev) or a CI secret (build).
        buildConfigField("String", "WIDGET_SERVICE_EMAIL", "\"widget-service@internal.duapharma\"")
        buildConfigField("String", "WIDGET_SERVICE_PASSWORD", "\"$widgetServicePassword\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // IMPORTANT: without this, Gradle falls back to the default debug
    // keystore, which on a CI runner is auto-generated fresh (and random)
    // on every single run. Two APKs signed with different debug keystores
    // are, to Android, two completely different apps — installing one over
    // the other fails with INSTALL_FAILED_UPDATE_INCOMPATIBLE, forcing an
    // uninstall (which wipes every home-screen widget) before every update.
    // shared-debug.keystore is committed to the repo specifically so every
    // build, from either CI run or either repo, signs with the exact same
    // certificate and always installs cleanly as an update. This is a
    // debug-only, internal-sideload key — not a Play Store release key —
    // so committing it is intentional and fine.
    signingConfigs {
        create("shared") {
            storeFile = file("../shared-debug.keystore")
            storePassword = "duapharma-shared-debug"
            keyAlias = "shareddebugkey"
            keyPassword = "duapharma-shared-debug"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        debug {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // Keystore-backed EncryptedSharedPreferences — used by WidgetAuthManager
    // to store the widget-service account's refresh token on-device.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
