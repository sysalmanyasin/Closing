package com.duapharma.closingwidget

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

/**
 * Matches the web app's per-shift reconciliation banner ("This shift
 * only" — the Audit tab / View-all popup subtitle), NOT the Aggregated
 * Final Closing strip (see AggregatedRepository, which is always the
 * period-since-last-Final roll-up).
 *
 * Every figure here is recomputed straight from each sheet's own
 * outNetSale / outNetCash / outPrevCash / outTotalCash — the same raw
 * fields actions.js's calc() always saves regardless of mode — rather
 * than reading the sheet's stored finalDiff/finalDiffLabel, which flip
 * to the period-aggregated figures whenever that particular save
 * happened to be a Final Closing (see actions.js's VARIANCE comment,
 * "isFinal = session.activeMode === 'final'"). That keeps this widget
 * showing THIS shift's own reconciliation even for sheets saved as a
 * Final Closing.
 */
data class ShiftClosingSnapshot(
    val date: String,
    val shift: String,
    val netCashAvailable: Double, // outTotalCash — grand total minus the Rs 45,000 till reserve
    val prevShiftCash: Double,    // outPrevCash — carried in from the previous shift
    val netCommittedCash: Double, // outNetCash — netCashAvailable − prevShiftCash − extraCash
    val targetNetSale: Double,    // outNetSale — this shift's own target, never the period total
    val diff: Double,             // netCommittedCash − targetNetSale
    val diffLabel: String
)

object LastShiftsRepository {

    private val SHIFT_ORDER = listOf("Night", "Morning", "Evening")

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 0 }
    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(kotlin.math.abs(value))

    /** Runs network I/O — must be called off the main thread. */
    fun fetchLastShiftClosings(limit: Int = 3): List<ShiftClosingSnapshot>? {
        val rows = fetchSheets(limit = 30) ?: return null
        if (rows.isEmpty()) return emptyList()

        // Reconstruct true shift order the same way Closing/Aggregated
        // repositories do — date desc, then Night < Morning < Evening —
        // rather than trusting updated_at.
        val sorted = rows.sortedWith(
            compareByDescending<RawSheet> { it.date }
                .thenByDescending { SHIFT_ORDER.indexOf(it.shift) }
        )

        return sorted.take(limit).map { sheet ->
            val data = sheet.data
            val netCashAvailable = data.optDouble("outTotalCash", 0.0)
            val prevShiftCash = data.optDouble("outPrevCash", 0.0)
            val netCommittedCash = data.optDouble("outNetCash", 0.0)
            val targetNetSale = data.optDouble("outNetSale", 0.0)
            val diff = netCommittedCash - targetNetSale
            val diffLabel = when {
                diff == 0.0 -> "Variance"
                diff > 0.0 -> "Plus"
                else -> "Less"
            }
            ShiftClosingSnapshot(
                date = sheet.date, shift = sheet.shift,
                netCashAvailable = netCashAvailable, prevShiftCash = prevShiftCash,
                netCommittedCash = netCommittedCash, targetNetSale = targetNetSale,
                diff = diff, diffLabel = diffLabel
            )
        }
    }

    private fun fetchSheets(limit: Int): List<RawSheet>? {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/sheets" +
            "?draft=eq.false" +
            "&order=date.desc" +
            "&limit=$limit" +
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
