package com.duapharma.closingwidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat
import java.util.Calendar
import java.util.Locale

/**
 * Reads the shared `bt_salesdata` table (single row, id="main", column
 * `payload`) — the same Supabase row BT Sale Data's own Manager > Credit
 * report (js/analytics.js getCreditSectionData()) reads from — and
 * reproduces its "Section-wise summary" / "Total Outstanding Credits"
 * math independently here, so the widgets don't depend on either app
 * being open.
 *
 * IMPORTANT: this is a completely different table from Closing's own
 * `credit_ledger` (that table is Closing's per-shift closing-book
 * snapshot feature — unrelated to BT Sale's Staff Credit / Jazz Cash /
 * Patty / Misc Sections, which live only inside `bt_salesdata.payload`).
 * An earlier version of this file read `credit_ledger` by mistake,
 * which is why the widgets used to show numbers that didn't match the
 * BT Sale Data app at all.
 *
 * `payload` shape (see BT Sale Data's js/supabase.js _buildPayload() /
 * js/manager-credit.js / js/ledger-store.js):
 *   payload.manager.credit[monthLabel] = [
 *     { staffId, name, prevBal, salary, lessGeneric,
 *       entries: [{ date, desc, amount }] }, ...
 *   ]
 *   — monthLabel is "July 2026" etc. Net per employee =
 *     prevBal + sum(entries.amount) - salary - lessGeneric.
 *   payload.ledger = {
 *     entries: [{ id, ledgerType, date, categoryId, amount, desc }],
 *     openingBalances: { [ledgerType]: number }
 *   }
 *   payload.ledgerCustomTypes = {
 *     [ledgerType]: { label, categories: [{ id, label, sign, ... }] }
 *   }
 *
 * Bucketing (mirrors js/analytics.js getCreditSectionData() and its
 * "Total Outstanding Credits" formula exactly):
 *   - Staff Credit  → *latest month with real data* only, summed net.
 *   - Jazz Cash     → LedgerStore running balance of ledgerType
 *     "jazzcash", all-time (opening balance + signed entries).
 *   - Patty/Expenses→ same, ledgerType "expense".
 *   - Misc Sections → same, summed across every *custom* ledgerType
 *     (Pharmacy, Miscellaneous, Less Amounts, Extra Credits,
 *     Adjustments & Strips, and any future misc account — whatever is
 *     currently registered in payload.ledgerCustomTypes), all-time.
 * grandTotal = staffCreditTotal + jazzCashTotal + pattyExpensesTotal + miscSectionsTotal
 */
object CreditRepository {

    data class StaffCreditRow(val srNum: Int, val name: String, val amount: Double)

    data class CreditSummary(
        val monthLabel: String,        // e.g. "July 2026" — the latest month with real Staff Credit data
        val staffCreditTotal: Double,  // sum of Staff Credit, that month only
        val jazzCashTotal: Double,     // all-time running balance
        val pattyExpensesTotal: Double,// all-time running balance
        val miscSectionsTotal: Double, // all-time, every custom ledger type summed
        val totalOutstanding: Double,  // sum of the four above
        val staffRows: List<StaffCreditRow> // sorted by Sr#, active staff only, that month's amount (0 if none)
    )

    private val MONTH_NAMES = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    )

    // Mirrors js/ledger-store.js LEDGER_CATEGORIES exactly (sign per category id).
    // "petty" ledgerType is intentionally omitted — BT Sale's own Credit
    // report (analytics.js) never reads it either; "expense" is the real,
    // currently-used Patty/Expenses ledger.
    private val JAZZCASH_SIGNS = mapOf(
        "credit" to 1.0, "debit" to -1.0, "withdrawal" to -1.0,
        "commission" to -1.0, "transfer" to -1.0
    )
    private val EXPENSE_SIGNS = mapOf(
        "bill" to 1.0, "fuel" to 1.0, "soap" to 1.0, "refresh" to 1.0,
        "extra" to 1.0, "guardIncentive" to 1.0, "pattyHO" to -1.0
    )

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
    }

    fun formatAmount(value: Double): String {
        val sign = if (value < 0) "-" else ""
        return "$sign₨${numberFormat.format(kotlin.math.abs(value))}"
    }

    private data class LedgerEntry(val ledgerType: String, val categoryId: String, val amount: Double)

    /** Runs network I/O — must be called off the main thread. */
    fun fetchCreditSummary(context: Context): CreditSummary? {
        val payload = fetchPayload(context) ?: return null

        val managerObj = payload.optJSONObject("manager")
        val creditObj = managerObj?.optJSONObject("credit")

        // ── Staff Credit — latest month WITH real data only ────────────
        val monthLabel = latestStaffCreditMonth(creditObj)
        val staffMap = LinkedHashMap<String, Double>() // name -> net, that month only
        if (monthLabel.isNotEmpty() && creditObj != null) {
            val rows = creditObj.optJSONArray(monthLabel) ?: JSONArray()
            for (i in 0 until rows.length()) {
                val emp = rows.optJSONObject(i) ?: continue
                val name = emp.optString("name", "").trim()
                if (name.isEmpty()) continue
                val entriesTotal = sumEntriesAmount(emp.optJSONArray("entries"))
                val net = numOf(emp.opt("prevBal")) + entriesTotal -
                    numOf(emp.opt("salary")) - numOf(emp.opt("lessGeneric"))
                staffMap[name] = (staffMap[name] ?: 0.0) + net
            }
        }
        val staffCreditTotal = staffMap.values.sum()

        // ── Jazz Cash / Patty / Misc Sections — all-time running balances ──
        val ledgerObj = payload.optJSONObject("ledger")
        val entries = parseLedgerEntries(ledgerObj?.optJSONArray("entries"))
        val openingBalances = ledgerObj?.optJSONObject("openingBalances")

        val jazzCashTotal = runningBalance(entries, "jazzcash", openingBalances, JAZZCASH_SIGNS)
        val pattyExpensesTotal = runningBalance(entries, "expense", openingBalances, EXPENSE_SIGNS)

        var miscSectionsTotal = 0.0
        val customTypes = payload.optJSONObject("ledgerCustomTypes")
        if (customTypes != null) {
            val keys = customTypes.keys()
            while (keys.hasNext()) {
                val ledgerType = keys.next()
                val def = customTypes.optJSONObject(ledgerType) ?: continue
                val signs = parseCategorySigns(def.optJSONArray("categories"))
                miscSectionsTotal += runningBalance(entries, ledgerType, openingBalances, signs)
            }
        }

        val totalOutstanding = staffCreditTotal + jazzCashTotal + pattyExpensesTotal + miscSectionsTotal

        val activeStaff = fetchActiveStaffSorted()
        val staffRows = if (activeStaff.isNotEmpty()) {
            activeStaff.map { (srNum, name) ->
                val amount = staffMap.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value ?: 0.0
                StaffCreditRow(srNum, name, amount)
            }
        } else {
            /* bt_staff unreachable/empty — fall back to whatever names showed up
               in this month's credit data, alphabetically, so the widget still
               shows something rather than nothing. */
            staffMap.entries.sortedBy { it.key }
                .mapIndexed { i, e -> StaffCreditRow(i + 1, e.key, e.value) }
        }

        return CreditSummary(
            monthLabel = monthLabel.ifEmpty { currentMonthLabel() },
            staffCreditTotal = staffCreditTotal,
            jazzCashTotal = jazzCashTotal,
            pattyExpensesTotal = pattyExpensesTotal,
            miscSectionsTotal = miscSectionsTotal,
            totalOutstanding = totalOutstanding,
            staffRows = staffRows
        )
    }

    // ── Staff Credit month resolution — mirrors js/analytics.js
    // latestStaffCreditMonth() exactly: among every month key present in
    // payload.manager.credit, pick the most recent one (not in the
    // future) that has at least one employee with a nonzero prevBal/
    // salary/lessGeneric OR a real dated entry. A month with entries
    // that are all blank/zero (e.g. the new calendar month before
    // anyone's touched it yet) is skipped in favor of the last month
    // that actually has something in it — this is what keeps the
    // widget on "July 2026" instead of jumping to an empty "August 2026"
    // just because the calendar turned over. ──
    private fun latestStaffCreditMonth(creditObj: JSONObject?): String {
        if (creditObj == null) return ""
        val current = currentMonthSortVal()
        var best = ""
        var bestVal = Int.MIN_VALUE
        val keys = creditObj.keys()
        while (keys.hasNext()) {
            val month = keys.next()
            val sortVal = monthSortVal(month)
            if (sortVal < 0 || sortVal > current) continue
            if (!monthHasCreditData(creditObj.optJSONArray(month))) continue
            if (sortVal > bestVal) { bestVal = sortVal; best = month }
        }
        return best
    }

    private fun monthHasCreditData(rows: JSONArray?): Boolean {
        if (rows == null) return false
        for (i in 0 until rows.length()) {
            val emp = rows.optJSONObject(i) ?: continue
            if (numOf(emp.opt("prevBal")) != 0.0) return true
            if (numOf(emp.opt("salary")) != 0.0) return true
            if (numOf(emp.opt("lessGeneric")) != 0.0) return true
            val entries = emp.optJSONArray("entries")
            if (entries != null) {
                for (j in 0 until entries.length()) {
                    val e = entries.optJSONObject(j) ?: continue
                    if (numOf(e.opt("amount")) != 0.0) return true
                    if (e.optString("desc", "").isNotEmpty()) return true
                    if (e.optString("date", "").isNotEmpty()) return true
                }
            }
        }
        return false
    }

    private fun sumEntriesAmount(entries: JSONArray?): Double {
        if (entries == null) return 0.0
        var total = 0.0
        for (i in 0 until entries.length()) {
            val e = entries.optJSONObject(i) ?: continue
            total += numOf(e.opt("amount"))
        }
        return total
    }

    // ── LedgerStore running-balance reproduction (mirrors
    // js/ledger-store.js getCurrentBalance() exactly): opening balance
    // for that ledgerType, plus every entry's signed amount, where the
    // sign comes from that ledgerType's category config — unknown
    // category ids default to sign -1, same as the web app. ──
    private fun runningBalance(
        entries: List<LedgerEntry>,
        ledgerType: String,
        openingBalances: JSONObject?,
        signs: Map<String, Double>
    ): Double {
        var bal = openingBalances?.let { if (it.has(ledgerType)) numOf(it.opt(ledgerType)) else 0.0 } ?: 0.0
        entries.forEach { e ->
            if (e.ledgerType == ledgerType) {
                val sign = signs[e.categoryId] ?: -1.0
                bal += sign * e.amount
            }
        }
        return bal
    }

    private fun parseCategorySigns(categories: JSONArray?): Map<String, Double> {
        val map = HashMap<String, Double>()
        if (categories != null) {
            for (i in 0 until categories.length()) {
                val c = categories.optJSONObject(i) ?: continue
                val id = c.optString("id", "")
                if (id.isNotEmpty()) map[id] = numOf(c.opt("sign")).let { if (it == 0.0) -1.0 else it }
            }
        }
        return map
    }

    private fun parseLedgerEntries(arr: JSONArray?): List<LedgerEntry> {
        if (arr == null) return emptyList()
        val out = ArrayList<LedgerEntry>(arr.length())
        for (i in 0 until arr.length()) {
            val e = arr.optJSONObject(i) ?: continue
            out.add(
                LedgerEntry(
                    ledgerType = e.optString("ledgerType", ""),
                    categoryId = e.optString("categoryId", ""),
                    amount = numOf(e.opt("amount"))
                )
            )
        }
        return out
    }

    private fun numOf(v: Any?): Double = when (v) {
        is Number -> v.toDouble()
        is String -> v.toDoubleOrNull() ?: 0.0
        else -> 0.0
    }

    private fun monthSortVal(my: String): Int {
        val parts = my.trim().split(" ")
        if (parts.size != 2) return -1
        val idx = MONTH_NAMES.indexOf(parts[0])
        val yr = parts[1].toIntOrNull() ?: return -1
        return if (idx >= 0) yr * 12 + idx else -1
    }

    private fun currentMonthSortVal(): Int {
        val cal = Calendar.getInstance()
        return cal.get(Calendar.YEAR) * 12 + cal.get(Calendar.MONTH)
    }

    private fun currentMonthLabel(): String {
        val cal = Calendar.getInstance()
        return "${MONTH_NAMES[cal.get(Calendar.MONTH)]} ${cal.get(Calendar.YEAR)}"
    }

    /** Fetches the single `bt_salesdata` row (id="main") and returns its `payload` JSON object. */
    private fun fetchPayload(context: Context): JSONObject? {
        val accessToken = WidgetAuthManager.getAccessToken(context) ?: return null

        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_salesdata?select=payload&id=eq.main"
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
            if (array.length() == 0) return null
            array.getJSONObject(0).optJSONObject("payload")
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    /** Active bt_staff, deduped by name (first row wins), sorted by srNum.
        Mirrors Closing's own js/bt-bridge.js fetchActiveStaff() rules.
        Deliberately still uses the anon key: bt_staff has an anon-readable
        "for login lookup" policy (Closing's phone/PIN sign-in needs it
        before a session exists), so unlike every other table here it never
        needed the widget-service identity. */
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
