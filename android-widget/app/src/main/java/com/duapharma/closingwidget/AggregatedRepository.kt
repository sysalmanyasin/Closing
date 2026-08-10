package com.duapharma.closingwidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
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

    // Chronological shift order within a day — Night starts the day, not
    // ends it (same convention as the web app and ClosingRepository).
    private val SHIFT_ORDER = listOf("Night", "Morning", "Evening")

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(kotlin.math.abs(value))

    /** Runs network I/O — must be called off the main thread. */
    fun fetchLatestAggregated(context: Context): AggregatedSummary? {
        val rows = fetchSheets(context, limit = 10) ?: return null
        if (rows.isEmpty()) return null

        // Reconstruct true shift order the same way ClosingRepository does —
        // date desc, then Night < Morning < Evening — rather than trusting
        // updated_at. Sorting by updated_at was the bug: any sheet that gets
        // re-saved/edited later (sync, correction, etc.) jumps to the top
        // even if its date is well in the past, which is how this widget
        // drifted out of sync with the (correctly date-sorted) Closing
        // Summary widget and the web app's own live strip.
        val sorted = rows.sortedWith(
            compareByDescending<RawSheet> { it.date }
                .thenByDescending { SHIFT_ORDER.indexOf(it.shift) }
        )

        val latest = sorted.first()
        val data = latest.data

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
            variance > 0.0 -> "Plus"
            else -> "Less"
        }

        // Same convention as the web app's banner: cash is shown gross
        // (target added back) so it lines up with Target Net Sales.
        return AggregatedSummary(
            date = latest.date,
            shift = latest.shift,
            targetNetSales = finalNetSale,
            preDateTotal = finalPreTotal,
            netCashAvailable = finalNetCash + finalNetSale,
            variance = variance,
            varianceLabel = varianceLabel
        )
    }

    private fun fetchSheets(context: Context, limit: Int): List<RawSheet>? {
        val accessToken = WidgetAuthManager.getAccessToken(context) ?: return null

        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/sheets" +
            "?draft=eq.false" +
            "&order=date.desc" +
            "&limit=$limit" +
            "&select=date,shift,data"

        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer $accessToken")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000

            if (connection.responseCode !in 200..299) return null

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val array = JSONArray(body)
            val result = ArrayList<RawSheet>(array.length())
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val data = row.optJSONObject("data") ?: continue
                result.add(
                    RawSheet(
                        date = row.optString("date", ""),
                        shift = row.optString("shift", ""),
                        data = data
                    )
                )
            }
            result
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
