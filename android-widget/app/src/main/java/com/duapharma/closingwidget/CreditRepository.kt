package com.duapharma.closingwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Locale

/**
 * Reads the shared `credit_ledger` + `bt_staff` tables (same Supabase
 * project the Closing web app and BT Sale Data already write to) and
 * reassembles the "Credit Details" breakdown shown on BT Sale Data's
 * Manager > Credit report — same math, computed independently here so
 * the widgets don't depend on either app being open.
 *
 * `credit_ledger.data` is one persisted shift snapshot
 * (Closing's `js/ledger-engine.js` clBuildSnapshot()) — a `lines[]`
 * array of {category, lbl, desc, val}:
 *   - category "tier"  → one line per Staff Credit name (lbl = staff name)
 *   - category "named" → named credit accounts (Jazz Cash, Patty/Expenses,
 *     Pharmacy, Miscellaneous, Less Amounts, Extra Credits, Adjustments
 *     & Strips, ...) — lbl is whatever the account is called in Settings.
 *   - category "aux"   → free-label one-off credit entries.
 *
 * Bucketing (mirrors the "Section-wise summary" in the reference
 * screenshot, and reproduces its "Total Outstanding Credits" formula
 * exactly): Staff Credit is the *latest month with data* only (all
 * other sections are all-time). Named accounts are matched by keyword
 * so newly added/renamed misc accounts fall into Misc Sections
 * automatically instead of silently vanishing from the total:
 *   - lbl contains "jazz"            → Jazz Cash
 *   - lbl contains "patty"/"expense" → Patty / Expenses
 *   - everything else (named + aux)  → Misc Sections
 *     (Pharmacy, Miscellaneous, Less Amounts, Extra Credits,
 *      Adjustments & Strips, and any future misc account land here)
 */
object CreditRepository {

    data class StaffCreditRow(val srNum: Int, val name: String, val amount: Double)

    data class CreditSummary(
        val monthLabel: String,        // e.g. "July 2026" — the latest month with data
        val staffCreditTotal: Double,  // sum of Staff Credit, that month only
        val jazzCashTotal: Double,     // all-time
        val pattyExpensesTotal: Double,// all-time
        val miscSectionsTotal: Double, // all-time
        val totalOutstanding: Double,  // sum of the four above
        val staffRows: List<StaffCreditRow> // sorted by Sr#, active staff only, that month's amount (0 if none)
    )

    private val MONTH_NAMES = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    )

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String {
        val sign = if (value < 0) "-" else ""
        return "$sign₨${numberFormat.format(kotlin.math.abs(value))}"
    }

    private data class Line(val category: String, val lbl: String, val val_: Double)
    private data class Snapshot(val date: String, val lines: List<Line>)

    /** Runs network I/O — must be called off the main thread. */
    fun fetchCreditSummary(): CreditSummary? {
        val snapshots = fetchAllSnapshots() ?: return null
        if (snapshots.isEmpty()) return null

        val latestMonthPrefix = snapshots.map { it.date }
            .filter { it.length >= 7 }
            .maxOrNull()
            ?.substring(0, 7) ?: return null

        val staffMap = LinkedHashMap<String, Double>()   // name -> total, latest month only
        val namedMap = LinkedHashMap<String, Double>()   // lbl  -> total, all-time
        var auxTotal = 0.0

        snapshots.forEach { snap ->
            val inLatestMonth = snap.date.length >= 7 && snap.date.substring(0, 7) == latestMonthPrefix
            snap.lines.forEach { line ->
                when (line.category) {
                    "tier" -> if (inLatestMonth) {
                        val key = line.lbl.trim()
                        if (key.isNotEmpty()) staffMap[key] = (staffMap[key] ?: 0.0) + line.val_
                    }
                    "named" -> {
                        val key = line.lbl.trim()
                        if (key.isNotEmpty()) namedMap[key] = (namedMap[key] ?: 0.0) + line.val_
                    }
                    "aux" -> auxTotal += line.val_
                }
            }
        }

        var jazzCashTotal = 0.0
        var pattyExpensesTotal = 0.0
        var miscSectionsTotal = auxTotal
        namedMap.forEach { (lbl, total) ->
            val l = lbl.lowercase(Locale.US)
            when {
                l.contains("jazz") -> jazzCashTotal += total
                l.contains("patty") || l.contains("expense") -> pattyExpensesTotal += total
                else -> miscSectionsTotal += total
            }
        }

        val staffCreditTotal = staffMap.values.sum()
        val totalOutstanding = staffCreditTotal + jazzCashTotal + pattyExpensesTotal + miscSectionsTotal

        val activeStaff = fetchActiveStaffSorted()
        val staffRows = if (activeStaff.isNotEmpty()) {
            activeStaff.map { (srNum, name) ->
                val amount = staffMap.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value ?: 0.0
                StaffCreditRow(srNum, name, amount)
            }
        } else {
            /* bt_staff unreachable/empty — fall back to whatever names showed up
               in this month's ledger, alphabetically, so the widget still shows
               something rather than nothing. */
            staffMap.entries.sortedBy { it.key }
                .mapIndexed { i, e -> StaffCreditRow(i + 1, e.key, e.value) }
        }

        val parts = latestMonthPrefix.split("-")
        val monthLabel = if (parts.size == 2) {
            val idx = (parts[1].toIntOrNull() ?: 1) - 1
            val name = MONTH_NAMES.getOrNull(idx) ?: parts[1]
            "$name ${parts[0]}"
        } else latestMonthPrefix

        return CreditSummary(
            monthLabel = monthLabel,
            staffCreditTotal = staffCreditTotal,
            jazzCashTotal = jazzCashTotal,
            pattyExpensesTotal = pattyExpensesTotal,
            miscSectionsTotal = miscSectionsTotal,
            totalOutstanding = totalOutstanding,
            staffRows = staffRows
        )
    }

    private fun fetchAllSnapshots(): List<Snapshot>? {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/credit_ledger?select=date,data"
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
            val result = ArrayList<Snapshot>(array.length())
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val date = row.optString("date", "")
                val data = row.optJSONObject("data") ?: continue
                val linesArr = data.optJSONArray("lines") ?: JSONArray()
                val lines = ArrayList<Line>(linesArr.length())
                for (j in 0 until linesArr.length()) {
                    val l = linesArr.optJSONObject(j) ?: continue
                    lines.add(
                        Line(
                            category = l.optString("category", ""),
                            lbl = l.optString("lbl", ""),
                            val_ = l.opt("val").let { v ->
                                when (v) {
                                    is Number -> v.toDouble()
                                    is String -> v.toDoubleOrNull() ?: 0.0
                                    else -> 0.0
                                }
                            }
                        )
                    )
                }
                result.add(Snapshot(date = date, lines = lines))
            }
            result
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    /** Active bt_staff, deduped by name (first row wins), sorted by srNum.
        Mirrors Closing's own js/bt-bridge.js fetchActiveStaff() rules. */
    private fun fetchActiveStaffSorted(): List<Pair<Int, String>> {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_staff?select=id,data"
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
            val seen = LinkedHashMap<String, Pair<Int, String>>() // normalized name -> (srNum, name)
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                val data = row.optJSONObject("data") ?: continue
                val active = data.isNull("active") || data.optBoolean("active", true)
                if (!active) continue
                val name = data.optString("name", "").trim()
                if (name.isEmpty()) continue
                val srNum = if (data.has("srNum") && !data.isNull("srNum")) data.optInt("srNum", 999) else 999
                val key = name.lowercase(Locale.US)
                if (!seen.containsKey(key)) seen[key] = srNum to name
            }
            seen.values.sortedBy { it.first }
        } catch (e: Exception) {
            emptyList()
        } finally {
            connection.disconnect()
        }
    }
}
