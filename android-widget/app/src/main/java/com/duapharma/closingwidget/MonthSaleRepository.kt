package com.duapharma.closingwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

data class MonthSaleBreakdown(
    val label: String,
    val total: Double,
    val cash: Double,
    val banks: Double,
    val cashBanks: Double,
    val credit: Double,
    val customers: Double
)

/**
 * Mirrors the web app's `_monthSaleBreakdown()` (js/cover-dashboard.js) —
 * breaks the latest month's TOTAL down into Cash, Banks, Cash & Banks
 * combined, Credit Clients (including free issue), and customer footfall,
 * for the "Latest Month Total Sale" hero card on the Cover dashboard.
 *
 * Same current-month-with-fallback-to-latest-record rule as the web app's
 * `_salesStatus()`/`_monthSaleBreakdown()`, and the same custom-field
 * folding as `mBanks()`/`creditSales()` in js/config.js (custom fields
 * tagged "Banks" or "Credit Clients" in Manage Fields are pulled from
 * `bt_col_config` and added/subtracted per their calcType — same as the
 * "Bank Alfalah 2" custom field already in use).
 */
object MonthSaleRepository {

    private val MONTH_NAMES = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    )
    private val MONTH_SHORT = listOf(
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    )
    private val BANK_COLS = listOf("HBL", "MCB", "Alfala Bank", "Bank Al Habib", "Meezan Bank (Paysa)")
    private val CLIENT_COLS = listOf(
        "PSO", "NESPAK", "PARCO", "TEPA", "LDA", "Gourmet", "Wapda Hospital", "BTH",
        "Berger Paints", "Ecolean PK", "Style Textile", "Syed Babar Ali Foundation",
        "Rahnuma NGO", "Health Pass", "Nisar Spinning Mills", "Food Panda",
        "Askari Bank", "Askari Bank Returns"
    )

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(value)
    fun formatCount(value: Double): String = numberFormat.format(value)

    /** value -> 0 for null/blank/non-numeric, else the parsed double. Mirrors config.js's n(). */
    private fun n(obj: JSONObject, key: String): Double {
        if (obj.isNull(key) || !obj.has(key)) return 0.0
        return when (val v = obj.opt(key)) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull() ?: 0.0
            else -> 0.0
        }
    }

    /** Returns fields must always reduce the total — mirrors config.js's negR(). */
    private fun negR(v: Double): Double = if (v > 0) -v else v

    /** Runs network I/O — must be called off the main thread. */
    fun fetchMonthSaleBreakdown(): MonthSaleBreakdown? {
        val now = Calendar.getInstance()
        val currentMonthFull = MONTH_NAMES[now.get(Calendar.MONTH)] + " " + now.get(Calendar.YEAR)

        val monthlyRows = fetchAllMonthly() ?: return null
        if (monthlyRows.isEmpty()) return null

        val rec = monthlyRows.find { it.first == currentMonthFull } ?: latestMonthlyRecord(monthlyRows)
        val (monthYear, data) = rec

        val customFields = fetchCustomFields()

        val cash = n(data, "Cash Sale") + negR(n(data, "Cash Returns"))

        var banks = BANK_COLS.sumOf { n(data, it) }
        var credit = CLIENT_COLS.sumOf { n(data, it) } + n(data, "F/Issue")
        for (field in customFields) {
            if (field.calcType == "none") continue
            val v = n(data, field.id)
            val signed = if (field.calcType == "sub") -kotlin.math.abs(v) else v
            when (field.section) {
                "Banks" -> if (field.id !in BANK_COLS) banks += signed
                "Credit Clients" -> if (field.id !in CLIENT_COLS) credit += signed
            }
        }

        val cashBanks = cash + banks
        val customers = n(data, "Customers")
        val total = n(data, "TOTAL")

        val lastDay = lastFilledDay(monthYear)
        val monthAbbrev = monthYear.split(" ").firstOrNull()?.take(3) ?: ""
        val label = "Latest Month Total Sale — $monthYear" +
            if (lastDay > 0) " (till $lastDay $monthAbbrev)" else ""

        return MonthSaleBreakdown(
            label = label,
            total = total,
            cash = cash,
            banks = banks,
            cashBanks = cashBanks,
            credit = credit,
            customers = customers
        )
    }

    /** Picks the chronologically-latest record — mirrors cover-dashboard.js's _latestMonthlyRecord(). */
    private fun latestMonthlyRecord(rows: List<Pair<String, JSONObject>>): Pair<String, JSONObject> {
        return rows.maxByOrNull { (monthYear, _) ->
            val parts = monthYear.split(" ")
            val monthName = parts.getOrNull(0) ?: ""
            val year = parts.getOrNull(1)?.toIntOrNull() ?: 0
            year * 100 + MONTH_NAMES.indexOf(monthName)
        } ?: rows.first()
    }

    private fun fetchAllMonthly(): List<Pair<String, JSONObject>>? {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_monthly?select=month_year,data"
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
            val result = ArrayList<Pair<String, JSONObject>>(array.length())
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val monthYear = row.optString("month_year", null) ?: continue
                val data = row.optJSONObject("data") ?: continue
                result.add(monthYear to data)
            }
            result
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private data class CustomField(val id: String, val section: String, val calcType: String)

    /** Reads Manage Fields' custom Bank/Credit Clients columns — mirrors config.js's _customBankSum()/_customCreditSum(). */
    private fun fetchCustomFields(): List<CustomField> {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_col_config?id=eq.main&select=custom"
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            if (connection.responseCode !in 200..299) return emptyList()

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val array = JSONArray(body)
            if (array.length() == 0) return emptyList()
            val custom = array.getJSONObject(0).optJSONArray("custom") ?: return emptyList()

            val result = ArrayList<CustomField>(custom.length())
            for (i in 0 until custom.length()) {
                val f = custom.getJSONObject(i)
                val id = f.optString("id", null) ?: continue
                val section = f.optString("section", "")
                val calcType = f.optString("calcType", "add")
                result.add(CustomField(id, section, calcType))
            }
            result
        } catch (e: Exception) {
            emptyList()
        } finally {
            connection.disconnect()
        }
    }

    /** Highest day-of-month with a filled (TOTAL > 0) daily row — mirrors cover-dashboard.js's _lastFilledDay(). */
    private fun lastFilledDay(monthYear: String): Int {
        val encodedMonth = URLEncoder.encode(monthYear, "UTF-8")
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_daily" +
            "?month_year=eq.$encodedMonth" +
            "&select=date,total:data->>TOTAL"

        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer ${BuildConfig.SUPABASE_ANON_KEY}")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            if (connection.responseCode !in 200..299) return 0

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val array = JSONArray(body)
            var maxDay = 0
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val total = row.optString("total", null)?.toDoubleOrNull() ?: 0.0
                if (total <= 0.0) continue
                val date = row.optString("date", "")
                val day = date.split("/").firstOrNull()?.toIntOrNull() ?: 0
                if (day > maxDay) maxDay = day
            }
            maxDay
        } catch (e: Exception) {
            0
        } finally {
            connection.disconnect()
        }
    }
}
