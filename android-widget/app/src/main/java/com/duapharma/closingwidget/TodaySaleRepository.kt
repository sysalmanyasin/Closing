package com.duapharma.closingwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class TodaySaleBreakdown(
    val label: String,
    val total: Double,
    val cash: Double,
    val card: Double,
    val credit: Double
)

/**
 * Mirrors the web app's `_todaySaleBreakdown()` (js/cover-dashboard.js)
 * and BT Sale Data's own Sale Data > Payments tab — Candela POS's live
 * Cash/Card/Credit split for today, read straight from
 * `sales_payment_summary` (synced by the sync-inventory-from-dropbox
 * Edge Function alongside `inventory_products`).
 *
 * Deliberately separate from MonthSaleRepository.kt: that one reads
 * `bt_monthly`, the manually-typed Sale Data ledger figures (Cash Sale/
 * Banks/Credit Clients fields staff enter by hand). This one is what
 * Candela itself recorded for today, synced automatically — the two can
 * legitimately disagree until that day's manual entry is filled in (or
 * ever, if reconciliation differences exist), same as the web app's own
 * header comment for `_todaySaleBreakdown()` notes.
 *
 * IMPORTANT — different Supabase project entirely, same one
 * InventoryRepository.kt reads (Pharmacy Audit Hub), not the
 * `bt_salesdata` project the other Sales/MonthSale/Aggregated/Closing
 * widgets use.
 */
object TodaySaleRepository {

    // Same project/key as BT Sale Data's js/sale-payments-bridge.js (SP_SUPABASE_URL / SP_SUPABASE_ANON_KEY)
    // and InventoryRepository.kt's INV_SUPABASE_URL/INV_SUPABASE_ANON_KEY — same Pharmacy Audit Hub project.
    private const val SP_SUPABASE_URL = "https://vtcrdkqhuvxatclobsby.supabase.co"
    private const val SP_SUPABASE_ANON_KEY = "sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy"

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 0 }
    fun formatAmount(value: Double): String = "Rs. " + numberFormat.format(value)

    private fun todayIso(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    /** value -> 0 for null/blank/non-numeric, else the parsed double. Mirrors config.js's n(). */
    private fun n(obj: JSONObject, key: String): Double {
        if (obj.isNull(key) || !obj.has(key)) return 0.0
        return when (val v = obj.opt(key)) {
            is Number -> v.toDouble()
            is String -> v.toDoubleOrNull() ?: 0.0
            else -> 0.0
        }
    }

    /**
     * Runs network I/O — must be called off the main thread. Fetches the
     * whole "today + last 3 days" synced window (full-refresh table, so
     * it's never more than 4 rows) and picks today's row if present,
     * falling back to whichever day is most recent otherwise — same
     * fallback shape as MonthSaleRepository's current-month-or-latest rule.
     */
    fun fetchTodaySaleBreakdown(): TodaySaleBreakdown? {
        val endpoint = "$SP_SUPABASE_URL/rest/v1/sales_payment_summary?select=*&order=sale_day.desc"
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", SP_SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer $SP_SUPABASE_ANON_KEY")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            if (connection.responseCode !in 200..299) return null

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val array = JSONArray(body)
            if (array.length() == 0) return null

            val todayIso = todayIso()
            val rec: JSONObject = run {
                for (i in 0 until array.length()) {
                    val row = array.getJSONObject(i)
                    if (row.optString("sale_day", "") == todayIso) return@run row
                }
                array.getJSONObject(0) // already sorted sale_day DESC — most recent day
            }

            val saleDay = rec.optString("sale_day", "")
            val isToday = saleDay == todayIso
            val label = if (isToday) "Today's Sale — POS Live" else "Latest POS Sale — $saleDay"

            TodaySaleBreakdown(
                label = label,
                total = n(rec, "total_sale"),
                cash = n(rec, "cash_sale"),
                card = n(rec, "card_sale"),
                credit = n(rec, "credit_sale")
            )
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
