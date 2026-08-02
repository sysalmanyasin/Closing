package com.duapharma.closingwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

/** Matches the app's "Latest Closing Summary" card. */
data class ClosingSummary(
    val date: String,
    val shift: String,
    val closingNumber: Int,
    val carriedCC: Double,
    val totalDeposits: Double,
    val bookBills: Double,
    val manualReturns: Double
)

private data class RawSheet(
    val date: String,
    val shift: String,
    val data: JSONObject
)

object ClosingRepository {

    private val SHIFT_ORDER = listOf("Night", "Morning", "Evening")
    private val SHIFT_NUMBER = mapOf("Night" to 1, "Morning" to 2, "Evening" to 3)

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(value)

    /** Runs network I/O — must be called off the main thread. */
    fun fetchLatestClosing(): ClosingSummary? {
        // Pull a window of recent, saved (non-draft) sheets — enough to walk
        // back to the last "final" closing for the Book Bills / Manual
        // Returns aggregation, same as the web app's aggregateSinceLastFinal().
        val rows = fetchSheets(limit = 90) ?: return null
        if (rows.isEmpty()) return null

        // Reconstruct true shift order: date desc, then Night < Morning < Evening.
        val sorted = rows.sortedWith(
            compareByDescending<RawSheet> { it.date }
                .thenByDescending { SHIFT_ORDER.indexOf(it.shift) }
        )

        val latest = sorted.first()
        val data = latest.data
        val profileMode = data.optString("profileMode", "shift")

        val carriedCC = data.optDouble("outPrevCC", 0.0)
        val totalDeposits = data.optDouble("outTotalF", 0.0)

        var bookBills: Double
        var manualReturns: Double

        if (profileMode == "final") {
            bookBills = data.optDouble("inBook1", 0.0) + data.optDouble("inBook2", 0.0)
            manualReturns = data.optDouble("posRet1", 0.0) +
                data.optDouble("posRet2", 0.0) +
                data.optDouble("posRet3", 0.0)
        } else {
            bookBills = 0.0
            manualReturns = 0.0
            // Walk backward through the reconstructed timeline, summing each
            // shift's book bills / manual returns until we hit a "final"
            // closing (exclusive) or run out of fetched history.
            for (i in 1 until sorted.size) {
                val rec = sorted[i].data
                if (rec.optString("profileMode", "shift") == "final") break
                bookBills += rec.optDouble("inBook1", 0.0) + rec.optDouble("inBook2", 0.0)
                manualReturns += rec.optDouble("posRet1", 0.0) +
                    rec.optDouble("posRet2", 0.0) +
                    rec.optDouble("posRet3", 0.0)
            }
        }

        return ClosingSummary(
            date = latest.date,
            shift = latest.shift,
            closingNumber = SHIFT_NUMBER[latest.shift] ?: 0,
            carriedCC = carriedCC,
            totalDeposits = totalDeposits,
            bookBills = bookBills,
            manualReturns = manualReturns
        )
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

