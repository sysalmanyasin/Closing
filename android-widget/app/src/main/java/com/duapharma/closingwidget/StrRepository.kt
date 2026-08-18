package com.duapharma.closingwidget

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Native-widget mirror of BT Sale Data's STR Report domain
 * (js/str-bridge.js's getFullData() + js/str-shared.js's strStage()/
 * isDispatchedFromBT()/isReceivedAtBT()). Same Supabase project/anon
 * key as InventoryRepository.kt (str_headers lives there too, RLS
 * resolves for the anon role only — same reasoning as str-bridge.js's
 * _getReadClient() comment, mirror it rather than re-litigate it).
 *
 * IMPORTANT — same rolling-window caveat as str-bridge.js: str_headers
 * only ever holds the last ~7 days of STRs (the sync Edge Function
 * fully deletes+reinserts every run), so these widgets can only ever
 * surface a *recent* awaited/dispatched STR, not deep history.
 */
object StrRepository {

    // Same project/key as js/str-bridge.js's STR_SUPABASE_URL/ANON_KEY
    // and InventoryRepository.kt's INV_SUPABASE_URL/ANON_KEY (one project).
    private const val STR_SUPABASE_URL = "https://vtcrdkqhuvxatclobsby.supabase.co"
    private const val STR_SUPABASE_ANON_KEY = "sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy"

    data class StrHeader(
        val strNumber: String,
        val strDate: String?,
        val dispatchedDate: String?,
        val dispatchStatus: String,
        val receiveDate: String?,
        val receiveStatus: String,
        val strStatus: String,
        val comments: String,
        val direction: String,      // 'out' == BT is the dispatch branch, 'in' == BT is the receive branch
        val dispatchBranch: String,
        val receiveBranch: String
    )

    /** Mirrors str-shared.js's strStage() — str_status itself is only
        Open/Close; the 3-stage lifecycle comes from dispatch_status/
        receive_status instead. */
    fun stage(h: StrHeader): String {
        if (h.receiveStatus == "Received") return "received"
        if (h.dispatchStatus == "Dispatched") return "dispatched"
        return "awaited"
    }

    /** Mirrors str-shared.js's isDispatchedFromBT() — direction is
        synced verbatim from the source system. */
    fun isDispatchedFromBT(h: StrHeader): Boolean = h.direction == "out"

    /** Mirrors str-shared.js's isReceivedAtBT(). */
    fun isReceivedAtBT(h: StrHeader): Boolean = h.direction == "in"

    /** str_status is only ever Open/Close per str-shared.js's comment —
        match case-insensitively since the source export's casing isn't
        contractually guaranteed. */
    fun isClosed(h: StrHeader): Boolean = h.strStatus.trim().equals("Close", ignoreCase = true) ||
        h.strStatus.trim().equals("Closed", ignoreCase = true)

    private val displayDateFmt = SimpleDateFormat("d MMM yyyy", Locale.US)
    private val isoDateFmts = listOf(
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US),
        SimpleDateFormat("yyyy-MM-dd", Locale.US)
    )

    /** Mirrors str-shared.js's fmtDate() closely enough for widget display. */
    fun formatDate(v: String?): String {
        if (v.isNullOrBlank()) return "—"
        for (fmt in isoDateFmts) {
            try {
                val d = fmt.parse(v.take(19)) ?: continue
                return displayDateFmt.format(d)
            } catch (e: Exception) { /* try next pattern */ }
        }
        return v
    }

    /** Runs network I/O — must be called off the main thread. Single
        page is plenty: str_headers is a rolling ~7-day window, currently
        ~175 rows (per str-bridge.js's own comment) — well under the
        1000-row PostgREST cap InventoryRepository/str-bridge.js paginate
        around for their much larger tables. */
    fun fetchHeaders(): List<StrHeader>? {
        val select = URLEncoder.encode(
            "str_number,str_date,dispatched_date,dispatch_status,receive_date,receive_status,str_status,comments,direction,dispatch_branch,receive_branch",
            "UTF-8"
        )
        val endpoint = "$STR_SUPABASE_URL/rest/v1/str_headers" +
            "?select=$select" +
            "&order=str_date.desc" +
            "&limit=1000"

        val connection = URL(endpoint).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", STR_SUPABASE_ANON_KEY)
            connection.setRequestProperty("Authorization", "Bearer $STR_SUPABASE_ANON_KEY")
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000

            if (connection.responseCode !in 200..299) return null

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val array = JSONArray(body)
            val result = ArrayList<StrHeader>(array.length())
            for (i in 0 until array.length()) {
                val row = array.getJSONObject(i)
                result.add(
                    StrHeader(
                        strNumber = row.optString("str_number", ""),
                        strDate = row.optString("str_date", null).takeUnless { it.isNullOrBlank() },
                        dispatchedDate = row.optString("dispatched_date", null).takeUnless { it.isNullOrBlank() },
                        dispatchStatus = row.optString("dispatch_status", ""),
                        receiveDate = row.optString("receive_date", null).takeUnless { it.isNullOrBlank() },
                        receiveStatus = row.optString("receive_status", ""),
                        strStatus = row.optString("str_status", ""),
                        comments = row.optString("comments", ""),
                        direction = row.optString("direction", ""),
                        dispatchBranch = row.optString("dispatch_branch", ""),
                        receiveBranch = row.optString("receive_branch", "")
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
