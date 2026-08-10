package com.duapharma.closingwidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Native-widget mirror of the web app's Misc/Ongoing Ledger "Latest
 * Snapshot + Aging" card (js/ledger-engine.js's mlAllSnapshots() /
 * mlComputeAging(), rendered by js/pages.js's mlBuildAgingCard()).
 * Reads the same synced `sheets` table every other widget in this
 * module reads (ClosingRepository, LastShiftsRepository, etc.) — no
 * separate backend needed, this table already mirrors db.sheets.
 *
 * IMPORTANT — same gotcha as the web version: aging is matched by
 * label text, not row id. Misc rows carry forward shift-to-shift
 * (pullPreviousShift() in actions.js) but each carried-forward row
 * gets a brand-new id from addMiscRow() every time — the old id is
 * never passed through — so id can't track a charge's history. A
 * renamed charge, or one deleted and recreated under the same name
 * after a gap, resets its aging clock here exactly like it does on
 * the web page. Keep this logic in sync with mlComputeAging() if
 * that ever changes.
 */
object MiscAgingRepository {

    data class AgingRow(
        val label: String,
        val value: Double,
        val since: String,   // "YYYY-MM-DD"
        val ageDays: Int
    )

    data class AgingResult(
        val date: String,     // latest snapshot's date
        val shift: String,    // latest snapshot's shift
        val rows: List<AgingRow>
    )

    private val SHIFT_ORDER = listOf("Night", "Morning", "Evening")

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 0 }
    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(kotlin.math.abs(value))

    private data class MiscSnapshot(val date: String, val shift: String, val lines: List<Pair<String, Double>>)

    /** Runs network I/O — must be called off the main thread. */
    fun fetchAging(context: Context): AgingResult? {
        // Generous cap: at default 6-month retention and up to a handful
        // of closings/day this comfortably covers full history without
        // an unbounded query. Bump if a shop's retention window grows.
        val rows = fetchSheets(context, limit = 1000) ?: return null
        if (rows.isEmpty()) return AgingResult("", "", emptyList())

        val sorted = rows.sortedWith(
            compareByDescending<RawSheet> { it.date }
                .thenByDescending { SHIFT_ORDER.indexOf(it.shift) }
        )

        // Mirrors mlAllSnapshots(): keep only sheets with at least one
        // non-deleted misc row that has a nonzero value or a label.
        val snapshots = sorted.mapNotNull { sheet -> toSnapshot(sheet) }
        val latest = snapshots.firstOrNull() ?: return AgingResult("", "", emptyList())

        val today = todayDateOnly()
        val agingRows = latest.lines.map { (label, value) ->
            val key = label.trim().lowercase(Locale.US)
            var firstSeenDate = latest.date

            outer@ for (snap in snapshots) {
                val stillThere = snap.lines.any { it.first.trim().lowercase(Locale.US) == key }
                if (!stillThere) break@outer
                firstSeenDate = snap.date
            }

            val ageDays = daysBetween(firstSeenDate, today).coerceAtLeast(0)
            AgingRow(label = label, value = value, since = firstSeenDate, ageDays = ageDays)
        }

        return AgingResult(date = latest.date, shift = latest.shift, rows = agingRows)
    }

    private fun toSnapshot(sheet: RawSheet): MiscSnapshot? {
        val miscRows = sheet.data.optJSONArray("miscRows") ?: return null
        val lines = ArrayList<Pair<String, Double>>()
        for (i in 0 until miscRows.length()) {
            val r = miscRows.optJSONObject(i) ?: continue
            if (r.optBoolean("deleted", false)) continue
            val label = r.optString("label", "").trim()
            val value = numOf(r.opt("val"))
            if (value == 0.0 && label.isEmpty()) continue
            lines.add((if (label.isEmpty()) "Untitled" else label) to value)
        }
        return if (lines.isEmpty()) null else MiscSnapshot(sheet.date, sheet.shift, lines)
    }

    private fun numOf(v: Any?): Double = when (v) {
        is Number -> v.toDouble()
        is String -> v.toDoubleOrNull() ?: 0.0
        else -> 0.0
    }

    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    private fun todayDateOnly(): String = dateFmt.format(Calendar.getInstance().time)

    /** Whole-day difference between two "YYYY-MM-DD" dates, `to` minus `from`. */
    private fun daysBetween(from: String, to: String): Int {
        return try {
            val fromCal = Calendar.getInstance().apply { time = dateFmt.parse(from)!!; clearTime() }
            val toCal = Calendar.getInstance().apply { time = dateFmt.parse(to)!!; clearTime() }
            val diffMs = toCal.timeInMillis - fromCal.timeInMillis
            (diffMs / 86_400_000L).toInt()
        } catch (e: Exception) {
            0
        }
    }

    private fun Calendar.clearTime() {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
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
