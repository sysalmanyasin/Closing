package com.duapharma.closingwidget

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

data class SalesSummary(
    val latestDateLabel: String,
    val latestTotal: Double,
    val changePct: Double?,
    val monthLabel: String,
    val monthTotal: Double,
    val daysEntered: Int,
    val daysInMonth: Int,
    val target: Double,
    val pctOfTarget: Double,
    val perDayPace: Double,
    val aheadOfPace: Double
)

object SalesRepository {

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }
    private val dayParser = SimpleDateFormat("dd/MMM/yyyy", Locale.ENGLISH)
    private val displayDateFormat = SimpleDateFormat("dd MMM yyyy", Locale.ENGLISH)

    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(value)
    fun formatPct(value: Double): String = numberFormat.format(value) + "%"

    /** Runs network I/O — must be called off the main thread. */
    fun fetchSalesSummary(): SalesSummary? {
        val now = Calendar.getInstance()
        val currentMonthAbbrev = SimpleDateFormat("MMM", Locale.ENGLISH).format(now.time)
        val currentYear = now.get(Calendar.YEAR)
        val currentMonthFull = SimpleDateFormat("MMMM yyyy", Locale.ENGLISH).format(now.time)
        val daysInMonth = now.getActualMaximum(Calendar.DAY_OF_MONTH)

        val prevCal = now.clone() as Calendar
        prevCal.add(Calendar.MONTH, -1)
        val prevMonthAbbrev = SimpleDateFormat("MMM", Locale.ENGLISH).format(prevCal.time)
        val prevYear = prevCal.get(Calendar.YEAR)

        // Fetch this month's and last month's daily rows (small windows via
        // ilike on the "DD/Mon/YYYY" text date column) — enough to find the
        // single latest day (for the day-over-day change) and this month's
        // running total, without pulling the whole multi-year table.
        val currentRows = fetchDailyRows("*/$currentMonthAbbrev/$currentYear") ?: return null
        val prevRows = fetchDailyRows("*/$prevMonthAbbrev/$prevYear") ?: return null

        val allRows = (currentRows + prevRows)
            .mapNotNull { (dateStr, total) ->
                val parsed = try { dayParser.parse(dateStr) } catch (e: Exception) { null }
                if (parsed != null) Triple(dateStr, parsed, total) else null
            }
            .sortedByDescending { it.second.time }

        if (allRows.isEmpty()) return null

        val latest = allRows[0]
        val previous = allRows.getOrNull(1)
        val changePct = if (previous != null && previous.third != 0.0) {
            (latest.third - previous.third) / previous.third * 100.0
        } else null

        val monthTotal = currentRows.sumOf { it.second }
        val daysEntered = currentRows.size

        val target = fetchTarget(currentMonthFull) ?: 0.0
        val perDayPace = if (daysInMonth > 0) target / daysInMonth else 0.0
        val pctOfTarget = if (target > 0) monthTotal / target * 100.0 else 0.0
        val aheadOfPace = monthTotal - (perDayPace * daysEntered)

        return SalesSummary(
            latestDateLabel = displayDateFormat.format(latest.second),
            latestTotal = latest.third,
            changePct = changePct,
            monthLabel = currentMonthFull,
            monthTotal = monthTotal,
            daysEntered = daysEntered,
            daysInMonth = daysInMonth,
            target = target,
            pctOfTarget = pctOfTarget,
            perDayPace = perDayPace,
            aheadOfPace = aheadOfPace
        )
    }

    /** Returns list of (dateString, total) for rows whose date matches the ilike pattern. */
    private fun fetchDailyRows(datePattern: String): List<Pair<String, Double>>? {
        val encodedPattern = URLEncoder.encode(datePattern, "UTF-8")
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_daily" +
            "?date=ilike.$encodedPattern" +
            "&select=date,total:data->>TOTAL"

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
            val result = ArrayList<Pair<String, Double>>(array.length())
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val date = row.optString("date", null) ?: continue
                val total = row.optString("total", null)?.toDoubleOrNull() ?: continue
                result.add(date to total)
            }
            result
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun fetchTarget(monthFull: String): Double? {
        val encodedMonth = URLEncoder.encode(monthFull, "UTF-8")
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_targets" +
            "?month=eq.$encodedMonth" +
            "&select=data" +
            "&limit=1"

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
            array.getJSONObject(0).optDouble("data", 0.0)
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
