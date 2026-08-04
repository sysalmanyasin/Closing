package com.duapharma.closingwidget

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

/**
 * Matches the web app's "Aggregated Final Closing" strip (Final Closing —
 * Period Aggregation card, Part 2). Unlike ClosingSummary (which reads
 * per-shift fields off the latest sheet), these four numbers are already
 * the *period-aggregated* result of calc()'s always-on Part 1 / Part 2
 * pipeline as of the moment the latest sheet was saved — the web app
 * computes and saves them on every closing, Shift or Final, so no
 * re-aggregation needs to happen here.
 */
data class AggregatedSummary(
    val date: String,
    val shift: String,
    val targetNetSales: Double,
    val preDateTotal: Double,
    val netCashAvailable: Double,
    val variance: Double,
    val varianceLabel: String
)

object AggregatedRepository {

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(kotlin.math.abs(value))

    /** Runs network I/O — must be called off the main thread. */
    fun fetchLatestAggregated(): AggregatedSummary? {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/sheets" +
            "?draft=eq.false" +
            "&order=updated_at.desc" +
            "&limit=1" +
            "&select=date,shift,data"

        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000

            if (connection.responseCode !in 200..299) return null

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val array = JSONArray(body)
            if (array.length() == 0) return null

            val row = array.getJSONObject(0)
            val data = row.optJSONObject("data") ?: return null

            // finalNetSale / finalNetCash / finalPreTotal are saved
            // directly on every sheet by the web app's calc() (its
            // Part 1/Part 2 pipeline runs in every mode) — see the
            // Aggregated Final Closing strip and Part 2's predate-group
            // subgroup, whose values these mirror exactly.
            //
            // Deliberately NOT using the saved finalDiff/finalDiffLabel
            // fields here: those are mode-aware (shift-only vs
            // period-aggregated, depending on which mode was active
            // when that particular sheet was saved — see actions.js's
            // VARIANCE comment). The Aggregated strip must always show
            // the period-aggregated variance, so it's derived fresh
            // from finalNetCash here, the same way the web app's own
            // aggDiff is computed unconditionally in its paint logic.
            val finalNetSale = data.optDouble("finalNetSale", 0.0)
            val finalNetCash = data.optDouble("finalNetCash", 0.0)
            val finalPreTotal = data.optDouble("finalPreTotal", 0.0)
            val variance = finalNetCash
            val varianceLabel = when {
                variance == 0.0 -> "Variance"
                variance > 0.0  -> "Plus"
                else            -> "Less"
            }

            // Same convention as the web app's banner: cash is shown gross
            // (target added back) so it lines up with Target Net Sales.
            AggregatedSummary(
                date = row.optString("date", ""),
                shift = row.optString("shift", ""),
                targetNetSales = finalNetSale,
                preDateTotal = finalPreTotal,
                netCashAvailable = finalNetCash + finalNetSale,
                variance = variance,
                varianceLabel = varianceLabel
            )
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
