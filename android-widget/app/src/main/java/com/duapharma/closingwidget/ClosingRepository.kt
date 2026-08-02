package com.duapharma.closingwidget

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

/** A single closing summary pulled from the `sheets` table. */
data class ClosingSummary(
    val date: String,
    val shift: String,
    val staff: String,
    val netSale: Double,
    val netCash: Double,
    val totalCash: Double
)

object ClosingRepository {

    private val currencyFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String = "Rs " + currencyFormat.format(value)

    /**
     * Fetches the most recently updated, non-draft closing sheet.
     * Runs network I/O — must be called off the main thread.
     */
    fun fetchLatestClosing(): ClosingSummary? {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/sheets" +
            "?draft=eq.false" +
            "&order=updated_at.desc" +
            "&limit=1" +
            "&select=date,shift,data,updated_at"

        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000

            if (connection.responseCode !in 200..299) return null

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val rows = JSONArray(body)
            if (rows.length() == 0) return null

            val row = rows.getJSONObject(0)
            val data = row.optJSONObject("data") ?: return null

            ClosingSummary(
                date = row.optString("date", "—"),
                shift = row.optString("shift", "—"),
                staff = data.optString("responsibleStaff", "—"),
                netSale = data.optDouble("finalNetSale", 0.0),
                netCash = data.optDouble("finalNetCash", 0.0),
                totalCash = data.optDouble("outTotalCash", 0.0)
            )
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
