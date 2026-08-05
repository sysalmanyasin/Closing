package com.duapharma.closingwidget

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor

/**
 * Inventory data engine — ports BT Sale Data's own inventory-health math
 * (js/stockledger.js computeAll()/getCoverStats(), js/excess-working.js
 * computeRows()/summarize(), js/reorder-report.js computeAllRows()/
 * topNByValue()/lowCoverWithin()) into Kotlin so the widgets don't need
 * either app open. Every formula below is a line-for-line port — see the
 * comment above each function for exactly which JS function it mirrors.
 *
 * IMPORTANT — different Supabase project entirely. Inventory data does
 * NOT live in the same `bt_salesdata` project as Staff Credit / Jazz
 * Cash (see CreditRepository.kt) — it lives in the separate Pharmacy
 * Audit Hub Supabase project, in table `inventory_products`, read
 * read-only exactly like BT Sale Data's own js/inventory-bridge.js does.
 */
object InventoryRepository {

    // Same project/key as BT Sale Data's js/inventory-bridge.js (INV_SUPABASE_URL / INV_SUPABASE_ANON_KEY).
    private const val INV_SUPABASE_URL = "https://vtcrdkqhuvxatclobsby.supabase.co"
    private const val INV_SUPABASE_ANON_KEY = "sb_publishable_h-Z3ldRXyb18HEjF68cJ0g_tmRgbrAy"

    private const val NEVER_SOLD_DAYS = 60.0
    private const val DEAD_STOCK_DAYS = 60.0
    private const val MIN_AGE_DAYS = 90.0     // Excess Working's own recalc filter, default ON
    private const val MIN_STOCK_DAYS = 200.0  // Excess Working's own recalc filter, default ON

    private val numberFormat = NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 0 }
    fun formatMoney(v: Double): String {
        val sign = if (v < 0) "-" else ""
        return "${sign}Rs. ${numberFormat.format(kotlin.math.abs(v))}"
    }
    fun formatQty(v: Double): String = numberFormat.format(v)

    // ── Raw product row, straight off inventory_products (matches
    // stockledger.js's normalizeSupabaseRow() field-for-field). ──
    data class Product(
        val code: String, val name: String,
        val stock: Double, val unitPrice: Double,
        val company: String, val generic: String, val supplier: String,
        val conversionFactor: Double?, // null == missing/invalid, same as JS `undefined`
        val creationDate: String?, val lastReceiveDate: String?, val lastSaleDate: String?,
        val netQty30: Double, val netQty60: Double, val netQty90: Double,
        val saleValueInclTax30: Double, val saleValueInclTax60: Double, val saleValueInclTax90: Double,
        val saleValueExclTax30: Double, val saleValueExclTax60: Double, val saleValueExclTax90: Double,
        val netQtyToday: Double, val saleValueInclTaxToday: Double, val saleValueExclTaxToday: Double,
        val isTaxable: Boolean
    )

    // ── Enriched row — the fields every widget's formula actually reads. ──
    data class Row(
        val p: Product,
        val stockValue: Double,
        val recDays: Double?, val saleDays: Double?, val hasSale: Boolean,
        val packValid: Boolean, val pack: Double,
        val net100: Double, val dailyRate90: Double, val target100: Double,
        val excessQty: Double, val daysOld: Double?, val stockDays: Double?
    )

    data class HeroStats(
        val dataReady: Boolean,
        val totalInventoryValue: Double, val negativeValue: Double,
        val neverSold60Value: Double, val deadStock60Value: Double,
        val asOf: String
    )

    data class ExcessRow(val code: String, val name: String, val company: String, val daysOld: Double?, val value: Double)
    data class ExcessSummary(val rawExcessValue: Double, val correctedExcessValue: Double, val topRows: List<ExcessRow>)

    data class ReorderRow(
        val code: String, val name: String, val coverDays: Double?,
        val demandQty: Double, val demandValue: Double, val saleQty: Double, val saleValue: Double
    )

    data class SellerRow(val code: String, val name: String, val saleQty: Double, val saleValue: Double)

    // ---------------------------------------------------------------
    // Fetch — paginated, mirrors inventory-bridge.js's _fetchAllProducts.
    // ---------------------------------------------------------------
    fun fetchAllProducts(): List<Product> {
        val all = ArrayList<Product>()
        var from = 0
        val pageSize = 1000
        while (true) {
            val cols = "code,name,qty,price,company,generic,supplier,conversion_factor," +
                "creation_date,last_receive_date,last_sale_date," +
                "net_qty_30_days,net_qty_60_days,net_qty_90_days," +
                "sale_value_incl_tax_30_days,sale_value_incl_tax_60_days,sale_value_incl_tax_90_days," +
                "sale_value_excl_tax_30_days,sale_value_excl_tax_60_days,sale_value_excl_tax_90_days," +
                "net_qty_today,sale_value_incl_tax_today,sale_value_excl_tax_today,is_taxable"
            val endpoint = "$INV_SUPABASE_URL/rest/v1/inventory_products?select=$cols&order=name.asc&offset=$from&limit=$pageSize"
            val page = fetchJsonArray(endpoint, INV_SUPABASE_ANON_KEY) ?: break
            if (page.length() == 0) break
            for (i in 0 until page.length()) all.add(rowToProduct(page.getJSONObject(i)))
            if (page.length() < pageSize) break
            from += pageSize
        }
        return all
    }

    private fun rowToProduct(row: JSONObject): Product {
        fun d(key: String): Double = row.opt(key).let { v -> when (v) { is Number -> v.toDouble(); is String -> v.toDoubleOrNull() ?: 0.0; else -> 0.0 } }
        fun s(key: String): String? = if (row.isNull(key)) null else row.optString(key, "").ifEmpty { null }
        val convRaw = row.opt("conversion_factor")
        val conv: Double? = when (convRaw) {
            is Number -> convRaw.toDouble()
            is String -> convRaw.toDoubleOrNull()
            else -> null
        }
        return Product(
            code = row.optString("code", ""), name = row.optString("name", ""),
            stock = d("qty"), unitPrice = d("price"),
            company = row.optString("company", ""), generic = row.optString("generic", ""),
            supplier = row.optString("supplier", ""),
            conversionFactor = conv,
            creationDate = s("creation_date"), lastReceiveDate = s("last_receive_date"), lastSaleDate = s("last_sale_date"),
            netQty30 = d("net_qty_30_days"), netQty60 = d("net_qty_60_days"), netQty90 = d("net_qty_90_days"),
            saleValueInclTax30 = d("sale_value_incl_tax_30_days"), saleValueInclTax60 = d("sale_value_incl_tax_60_days"), saleValueInclTax90 = d("sale_value_incl_tax_90_days"),
            saleValueExclTax30 = d("sale_value_excl_tax_30_days"), saleValueExclTax60 = d("sale_value_excl_tax_60_days"), saleValueExclTax90 = d("sale_value_excl_tax_90_days"),
            netQtyToday = d("net_qty_today"), saleValueInclTaxToday = d("sale_value_incl_tax_today"), saleValueExclTaxToday = d("sale_value_excl_tax_today"),
            isTaxable = row.optBoolean("is_taxable", false)
        )
    }

    // Excess Working's Retain Stock List — synced via bt_salesdata.payload.excessRetain
    // (same shared row CreditRepository reads; see that file's header for why).
    fun fetchExcessRetainSet(): Set<String> {
        val endpoint = "${BuildConfig.SUPABASE_URL}/rest/v1/bt_salesdata?select=payload&id=eq.main"
        val arr = fetchJsonArray(endpoint, BuildConfig.SUPABASE_ANON_KEY) ?: return emptySet()
        if (arr.length() == 0) return emptySet()
        val payload = arr.getJSONObject(0).optJSONObject("payload") ?: return emptySet()
        val retain = payload.optJSONArray("excessRetain") ?: return emptySet()
        val set = HashSet<String>()
        for (i in 0 until retain.length()) set.add(retain.optString(i, "").trim().lowercase(Locale.US))
        return set
    }

    private fun daysSince(dateStr: String?, refNow: Long): Double? {
        if (dateStr.isNullOrEmpty()) return null
        return try {
            val d = parseIsoDate(dateStr) ?: return null
            floor((refNow - d).toDouble() / 86400000.0)
        } catch (e: Exception) { null }
    }

    // Supabase/Postgres timestamps show up as "2026-07-01", "2026-07-01T00:00:00+00:00",
    // or "2026-07-01 00:00:00+00" — try the offset-aware parser first (handles "+00:00"
    // and "+00", which Instant.parse's strict ISO_INSTANT rejects since it requires a
    // literal "Z"), then a bare-date fallback.
    private fun parseIsoDate(str: String): Long? {
        if (str.length <= 10) {
            return try { java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(str.take(10))?.time } catch (e: Exception) { null }
        }
        val normalized = str.replace(" ", "T").let { if (it.endsWith("Z")) it else it }
        return try {
            java.time.OffsetDateTime.parse(normalized).toInstant().toEpochMilli()
        } catch (e: Exception) {
            try { java.time.Instant.parse(if (normalized.endsWith("Z")) normalized else "${normalized}Z").toEpochMilli() }
            catch (e2: Exception) {
                try { java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(str.take(10))?.time } catch (e3: Exception) { null }
            }
        }
    }

    private fun isPackValid(v: Double?): Boolean = v != null && v.isFinite() && v > 0

    // downRound(stock, pack) — js/stockledger.js: floor to whole packs, discard the loose remainder.
    private fun downRoundQty(stock: Double, pack: Double): Double {
        val p = if (pack > 0) pack else 1.0
        val packs = floor(stock / p)
        return packs * p
    }

    /** Builds enriched rows — mirrors stockledger.js computeAll()'s per-item math (sections 1–3). */
    fun computeRows(products: List<Product>, now: Long = System.currentTimeMillis()): List<Row> {
        return products.map { p ->
            val recDays = daysSince(p.lastReceiveDate, now)
            val saleDays = daysSince(p.lastSaleDate, now)
            val hasSale = !p.lastSaleDate.isNullOrEmpty()
            val packValid = isPackValid(p.conversionFactor)
            val pack = if (packValid) p.conversionFactor!! else 1.0
            val net100 = p.netQty90
            val dailyRate90 = net100 / 90.0
            val target100 = dailyRate90 * 100.0
            val excessQty = p.stock - target100
            val daysOld = daysSince(p.creationDate, now)
            val stockDays = if (dailyRate90 > 0) p.stock / dailyRate90 else null
            Row(p, p.stock * p.unitPrice, recDays, saleDays, hasSale, packValid, pack, net100, dailyRate90, target100, excessQty, daysOld, stockDays)
        }
    }

    /** Mirrors stockledger.js getCoverStats() exactly. */
    fun heroStats(rows: List<Row>, asOfLabel: String): HeroStats {
        if (rows.isEmpty()) return HeroStats(false, 0.0, 0.0, 0.0, 0.0, asOfLabel)
        var totalInventoryValue = 0.0; var negativeValue = 0.0; var neverSold60Value = 0.0; var deadStock60Value = 0.0
        rows.forEach { r ->
            val stock = r.p.stock; val unitPrice = r.p.unitPrice
            val v = stock * unitPrice
            totalInventoryValue += v
            if (stock < 0) negativeValue += v
            if (stock == 0.0) return@forEach // js: zero-stock rows never reach Never Sold / Dead Stock
            if (stock > 0 && r.packValid) {
                val recDays = r.recDays
                if (!r.hasSale && recDays != null && recDays > NEVER_SOLD_DAYS) {
                    val dr = downRoundQty(stock, r.pack)
                    if (dr > 0) neverSold60Value += dr * unitPrice
                }
                val saleDays = r.saleDays
                if (r.hasSale && saleDays != null && saleDays > DEAD_STOCK_DAYS && recDays != null && recDays > DEAD_STOCK_DAYS) {
                    val dr = downRoundQty(stock, r.pack)
                    if (dr > 0) deadStock60Value += dr * unitPrice
                }
            }
        }
        return HeroStats(true, totalInventoryValue, negativeValue, neverSold60Value, deadStock60Value, asOfLabel)
    }

    /** Mirrors excess-working.js: applyRecalcFilters -> computeRows -> summarize. Misc buffer is a
        per-device-only setting in BT Sale Data (never synced to Supabase), so it's treated as 0 here —
        matches the common case where nobody has set one, and is the exact value if they haven't. */
    fun excessSummary(rows: List<Row>, retainSet: Set<String>, topN: Int = 10): ExcessSummary {
        val candidates = rows.filter { it.net100 > 0 && it.excessQty > 0 && it.p.stock >= 4 }
        val filtered = candidates.filter { r ->
            val ageOk = r.daysOld == null || r.daysOld >= MIN_AGE_DAYS
            val stockDaysOk = r.stockDays != null && r.stockDays >= MIN_STOCK_DAYS
            ageOk && stockDaysOk
        }
        data class Computed(val row: Row, val correctedValue: Double, val status: String)
        val computed = filtered.map { r ->
            val qty = r.excessQty
            val value = r.excessQty * r.p.unitPrice
            var factor = r.p.conversionFactor
            val packUnreliable = !(factor != null && factor > 0 && factor.isFinite())
            if (packUnreliable) factor = 1.0
            val packQty = floor(qty / (factor ?: 1.0))
            val correctedValue = if (qty > 0) floor((value / qty) * (packQty * (factor ?: 1.0))) else 0.0
            val nameKey = r.p.name.trim().lowercase(Locale.US)
            val status = when {
                retainSet.contains(nameKey) -> "Retained"
                packQty == 0.0 -> "Loose"
                else -> "Excess"
            }
            Computed(r, correctedValue, status)
        }
        val rawExcessValue = computed.filter { it.status == "Excess" }.sumOf { it.correctedValue }
        val correctedExcessValue = rawExcessValue // misc buffer unavailable remotely -> treated as 0
        val top = computed.filter { it.status == "Excess" }
            .sortedByDescending { it.correctedValue }
            .take(topN)
            .map { ExcessRow(it.row.p.code, it.row.p.name, it.row.p.company.ifEmpty { it.row.p.supplier }, it.row.daysOld, it.correctedValue) }
        return ExcessSummary(rawExcessValue, correctedExcessValue, top)
    }

    // ── Reorder / Top Sellers — mirrors reorder-report.js computeAllRows() /
    // topNByValue() / lowCoverWithin() exactly (windowDays in {30,60,90}). ──
    private data class WindowedRow(val p: Product, val saleQtyP: Double, val saleValueP: Double, val daysCoverP: Double?, val demandQtyP: Double)

    private fun computeWindowedRows(products: List<Product>, primaryWindow: Int, coverDaysThreshold: Double, includeToday: Boolean, now: Long): List<WindowedRow> {
        val startOfToday = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
        }.timeInMillis
        val todayFraction = ((now - startOfToday).toDouble() / 86400000.0).coerceIn(0.0, 1.0)
        val foldToday = includeToday

        return products.map { p ->
            val stock = p.stock; val unitPrice = p.unitPrice
            val todayQty = p.netQtyToday
            val todayValue = if (p.isTaxable) p.saleValueInclTaxToday else p.saleValueExclTaxToday
            val foldQty = if (foldToday) todayQty else 0.0
            val foldValue = if (foldToday) todayValue else 0.0

            val historicalQty: Double; val historicalValue: Double
            when (primaryWindow) {
                30 -> { historicalQty = p.netQty30; historicalValue = if (p.isTaxable) p.saleValueInclTax30 else p.saleValueExclTax30 }
                60 -> { historicalQty = p.netQty60; historicalValue = if (p.isTaxable) p.saleValueInclTax60 else p.saleValueExclTax60 }
                else -> { historicalQty = p.netQty90; historicalValue = if (p.isTaxable) p.saleValueInclTax90 else p.saleValueExclTax90 }
            }
            val saleQty = historicalQty + foldQty
            val saleValue = historicalValue + foldValue
            val windowEffectiveDays = primaryWindow + (if (foldToday) todayFraction else 0.0)
            val dailyRate = if (windowEffectiveDays > 0) saleQty / windowEffectiveDays else 0.0
            val daysCover = if (dailyRate > 0) stock / dailyRate else null
            val demandQty = if (dailyRate > 0) kotlin.math.max(0.0, ceil(dailyRate * coverDaysThreshold - stock)) else 0.0
            WindowedRow(p, saleQty, saleValue, daysCover, demandQty)
        }
    }

    private fun topNByValue(rows: List<WindowedRow>, n: Int): List<WindowedRow> =
        rows.filter { it.saleQtyP > 0 }.sortedByDescending { it.saleValueP }.take(n)

    private fun lowCoverWithin(rows: List<WindowedRow>, coverDays: Double): List<WindowedRow> =
        rows.filter { it.saleQtyP > 0 && it.daysCoverP != null && it.daysCoverP < coverDays }

    /** Mirrors ReorderReportApp.getFlaggedRowsFor(windowDays, coverDaysThreshold, topN, includeToday). */
    fun reorderRows(products: List<Product>, windowDays: Int = 30, coverDaysThreshold: Double = 7.0, topN: Int = 500, includeToday: Boolean = true): List<ReorderRow> {
        val all = computeWindowedRows(products, windowDays, coverDaysThreshold, includeToday, System.currentTimeMillis())
        val flagged = lowCoverWithin(topNByValue(all, topN), coverDaysThreshold)
        return flagged.map { ReorderRow(it.p.code, it.p.name, it.daysCoverP, it.demandQtyP, it.demandQtyP * it.p.unitPrice, it.saleQtyP, it.saleValueP) }
    }

    /** Mirrors ReorderReportApp.getFlaggedTotalFor — same pipeline, no Top-N cap. */
    fun reorderTotalFlagged(products: List<Product>, windowDays: Int = 30, coverDaysThreshold: Double = 7.0, includeToday: Boolean = true): Int {
        val all = computeWindowedRows(products, windowDays, coverDaysThreshold, includeToday, System.currentTimeMillis())
        return lowCoverWithin(all, coverDaysThreshold).size
    }

    /** Mirrors ReorderReportApp.getTopSellersFor(windowDays, topN, includeToday) — best sellers by value, no cover filter. */
    fun topSellers(products: List<Product>, windowDays: Int = 30, topN: Int = 10, includeToday: Boolean = true): List<SellerRow> {
        val all = computeWindowedRows(products, windowDays, 7.0, includeToday, System.currentTimeMillis())
        return topNByValue(all, topN).map { SellerRow(it.p.code, it.p.name, it.saleQtyP, it.saleValueP) }
    }

    // ── Negative Stock / Dead Stock / Never-Sold — per-item rows behind
    // heroStats()'s three aggregate totals above, sorted value-wise. ──
    data class StockValueRow(val code: String, val name: String, val company: String, val extra: String, val value: Double)

    /** Every item with stock < 0, most negative value first — mirrors the
        `negativeValue` branch of heroStats() but per-item instead of summed. */
    fun negativeStockRows(rows: List<Row>, topN: Int = 50): List<StockValueRow> {
        return rows.asSequence()
            .filter { it.p.stock < 0 }
            .map { r ->
                StockValueRow(
                    r.p.code, r.p.name, r.p.company.ifEmpty { r.p.supplier },
                    "${formatQty(r.p.stock)} units", r.p.stock * r.p.unitPrice
                )
            }
            .sortedBy { it.value } // most negative first
            .take(topN)
            .toList()
    }

    /** Every item flagged Dead Stock (sold before, nothing in 60D+), highest
        value first — same eligibility test as heroStats()'s deadStock60Value
        branch, just kept per-item instead of summed. */
    fun deadStockRows(rows: List<Row>, topN: Int = 20): List<StockValueRow> {
        val out = ArrayList<StockValueRow>()
        rows.forEach { r ->
            val stock = r.p.stock
            if (stock > 0 && r.packValid) {
                val recDays = r.recDays; val saleDays = r.saleDays
                if (r.hasSale && saleDays != null && saleDays > DEAD_STOCK_DAYS && recDays != null && recDays > DEAD_STOCK_DAYS) {
                    val dr = downRoundQty(stock, r.pack)
                    if (dr > 0) {
                        val value = dr * r.p.unitPrice
                        out.add(StockValueRow(r.p.code, r.p.name, r.p.company.ifEmpty { r.p.supplier }, "${saleDays.toInt()}d since last sale", value))
                    }
                }
            }
        }
        return out.sortedByDescending { it.value }.take(topN)
    }

    /** Every item flagged Never Sold (received 60D+ ago, no sale ever),
        highest value first — same eligibility test as heroStats()'s
        neverSold60Value branch, just kept per-item instead of summed. */
    fun neverSoldStockRows(rows: List<Row>, topN: Int = 20): List<StockValueRow> {
        val out = ArrayList<StockValueRow>()
        rows.forEach { r ->
            val stock = r.p.stock
            if (stock > 0 && r.packValid) {
                val recDays = r.recDays
                if (!r.hasSale && recDays != null && recDays > NEVER_SOLD_DAYS) {
                    val dr = downRoundQty(stock, r.pack)
                    if (dr > 0) {
                        val value = dr * r.p.unitPrice
                        out.add(StockValueRow(r.p.code, r.p.name, r.p.company.ifEmpty { r.p.supplier }, "${recDays.toInt()}d since receive", value))
                    }
                }
            }
        }
        return out.sortedByDescending { it.value }.take(topN)
    }

    // ---------------------------------------------------------------
    // Product search (Widget 6) — server-side ilike on name/code, same
    // fields inventory_products already carries (no separate fetch-all).
    // ---------------------------------------------------------------
    data class SearchResult(val code: String, val name: String)
    data class ProductDetail(
        val code: String, val name: String, val generic: String, val company: String, val supplier: String,
        val retailPrice: Double, val quantity: Double, val qty30: Double, val qty60: Double, val qty90: Double
    )

    fun searchProducts(query: String, limit: Int = 20): List<SearchResult> {
        if (query.isBlank()) return emptyList()
        val filter = URLEncoder.encode("(name.ilike.*${query.trim()}*,code.ilike.*${query.trim()}*)", "UTF-8")
        val endpoint = "$INV_SUPABASE_URL/rest/v1/inventory_products?select=code,name&or=$filter&order=name.asc&limit=$limit"
        val arr = fetchJsonArray(endpoint, INV_SUPABASE_ANON_KEY) ?: return emptyList()
        val out = ArrayList<SearchResult>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(SearchResult(o.optString("code", ""), o.optString("name", "")))
        }
        return out
    }

    fun fetchProductDetail(code: String): ProductDetail? {
        val encodedCode = URLEncoder.encode(code, "UTF-8")
        val cols = "code,name,generic,company,supplier,price,qty,net_qty_30_days,net_qty_60_days,net_qty_90_days"
        val endpoint = "$INV_SUPABASE_URL/rest/v1/inventory_products?select=$cols&code=eq.$encodedCode&limit=1"
        val arr = fetchJsonArray(endpoint, INV_SUPABASE_ANON_KEY) ?: return null
        if (arr.length() == 0) return null
        val o = arr.getJSONObject(0)
        fun d(key: String): Double = o.opt(key).let { v -> when (v) { is Number -> v.toDouble(); is String -> v.toDoubleOrNull() ?: 0.0; else -> 0.0 } }
        return ProductDetail(
            code = o.optString("code", ""), name = o.optString("name", ""),
            generic = o.optString("generic", ""), company = o.optString("company", ""), supplier = o.optString("supplier", ""),
            retailPrice = d("price"), quantity = d("qty"),
            qty30 = d("net_qty_30_days"), qty60 = d("net_qty_60_days"), qty90 = d("net_qty_90_days")
        )
    }

    // ---------------------------------------------------------------
    // Shared HTTP helper
    // ---------------------------------------------------------------
    private fun fetchJsonArray(endpoint: String, anonKey: String): JSONArray? {
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(endpoint).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.setRequestProperty("apikey", anonKey)
            connection.setRequestProperty("Authorization", "Bearer $anonKey")
            connection.connectTimeout = 12_000
            connection.readTimeout = 12_000
            if (connection.responseCode !in 200..299) return null
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            JSONArray(body)
        } catch (e: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }
}
