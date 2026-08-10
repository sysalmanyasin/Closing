package com.duapharma.closingwidget

import android.content.Context
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Holds a Supabase session for the dedicated "widget service" account
 * (see bt_widget_service_accounts / is_widget_service() on the BT SALE
 * DATA Supabase project). That account has no admin or staff privileges —
 * RLS only lets it SELECT from the handful of tables the widgets read
 * (sheets, bt_salesdata, bt_daily, bt_monthly, bt_col_config, bt_targets).
 * It cannot write anything and unlocks no other capability in either app,
 * so a compromised widget token is a read-only leak of dashboard numbers,
 * not an admin/staff credential.
 *
 * The only long-lived secret here is the refresh token, stored in
 * EncryptedSharedPreferences (Android Keystore-backed). Access tokens are
 * short-lived and re-minted from it on every widget refresh.
 */
object WidgetAuthManager {

    private const val TAG = "WidgetAuthManager"
    private const val PREFS_FILE = "widget_auth_secure_prefs"
    private const val KEY_REFRESH_TOKEN = "refresh_token"

    private fun prefs(context: Context) = run {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    /**
     * Runs network I/O — must be called off the main thread (same convention
     * as every *Repository.kt in this app; call from inside the existing
     * `thread { ... }` blocks in the widget providers).
     *
     * Returns a valid access token for the widget-service account, or null
     * if sign-in/refresh failed. Repositories already treat a failed fetch
     * as "couldn't load" / keep last known widget contents, so callers can
     * just bail out the same way they do on any other network failure.
     */
    fun getAccessToken(context: Context): String? {
        val store = prefs(context)
        val storedRefreshToken = store.getString(KEY_REFRESH_TOKEN, null)

        if (storedRefreshToken != null) {
            refreshSession(storedRefreshToken)?.let { (access, refresh) ->
                store.edit().putString(KEY_REFRESH_TOKEN, refresh).apply()
                return access
            }
            // Stored refresh token expired/revoked (e.g. password was
            // rotated in Supabase) — fall through and sign in fresh below.
        }

        signInWithPassword()?.let { (access, refresh) ->
            store.edit().putString(KEY_REFRESH_TOKEN, refresh).apply()
            return access
        }

        return null
    }

    private fun signInWithPassword(): Pair<String, String>? {
        if (BuildConfig.WIDGET_SERVICE_PASSWORD.isEmpty()) {
            Log.w(TAG, "WIDGET_SERVICE_PASSWORD is not set — add it to local.properties " +
                "(dev) or the WIDGET_SERVICE_PASSWORD CI secret (build).")
            return null
        }
        val endpoint = "${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=password"
        val body = JSONObject().apply {
            put("email", BuildConfig.WIDGET_SERVICE_EMAIL)
            put("password", BuildConfig.WIDGET_SERVICE_PASSWORD)
        }
        return postForTokens(endpoint, body)
    }

    private fun refreshSession(refreshToken: String): Pair<String, String>? {
        val endpoint = "${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
        val body = JSONObject().apply {
            put("refresh_token", refreshToken)
        }
        return postForTokens(endpoint, body)
    }

    /** Returns (accessToken, refreshToken) on success. */
    private fun postForTokens(endpoint: String, body: JSONObject): Pair<String, String>? {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

            if (connection.responseCode !in 200..299) {
                Log.w(TAG, "Token request failed: HTTP ${connection.responseCode}")
                return null
            }

            val responseBody = connection.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(responseBody)
            val accessToken = json.optString("access_token", "")
            val refreshToken = json.optString("refresh_token", "")
            if (accessToken.isEmpty() || refreshToken.isEmpty()) return null
            accessToken to refreshToken
        } catch (e: Exception) {
            Log.w(TAG, "Token request error", e)
            null
        } finally {
            connection.disconnect()
        }
    }
}
