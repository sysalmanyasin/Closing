package com.duapharma.closingwidget

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

/** Widget 6's real interactive search screen: type a product name or code,
    pick a match from the live dropdown (or tap Search), see full details —
    Generic, Retail Price, Quantity, Company, Supplier, and 30/60/90-day
    sale quantities — straight from the same inventory_products table BT
    Sale Data's own Inventory pages read. */
class ProductSearchActivity : AppCompatActivity() {

    private val debounceHandler = Handler(Looper.getMainLooper())
    private var pendingSearch: Runnable? = null
    private var selectedCode: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_product_search)

        val queryInput = findViewById<EditText>(R.id.search_query_input)
        val suggestionsContainer = findViewById<LinearLayout>(R.id.search_suggestions_container)
        val searchButton = findViewById<Button>(R.id.search_button)
        val statusText = findViewById<TextView>(R.id.search_status_text)
        val detailContainer = findViewById<LinearLayout>(R.id.search_detail_container)

        fun runSearch(query: String) {
            if (query.isBlank()) {
                suggestionsContainer.removeAllViews()
                statusText.text = ""
                return
            }
            statusText.text = "Searching…"
            thread {
                val results = try { InventoryRepository.searchProducts(query) } catch (e: Exception) { null }
                runOnUiThread {
                    suggestionsContainer.removeAllViews()
                    if (results == null) {
                        statusText.text = "Couldn't reach inventory — check connection"
                    } else if (results.isEmpty()) {
                        statusText.text = "No matches for \"$query\""
                    } else {
                        statusText.text = "${results.size} match${if (results.size == 1) "" else "es"} — tap one"
                        results.forEach { r ->
                            val row = TextView(this).apply {
                                text = "${r.name}  ·  ${r.code}"
                                textSize = 14f
                                setPadding(24, 24, 24, 24)
                                setOnClickListener {
                                    queryInput.setText(r.name)
                                    selectedCode = r.code
                                    suggestionsContainer.removeAllViews()
                                    showDetail(r.code, detailContainer, statusText)
                                }
                            }
                            suggestionsContainer.addView(row)
                        }
                    }
                }
            }
        }

        queryInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                selectedCode = null
                pendingSearch?.let { debounceHandler.removeCallbacks(it) }
                val text = s?.toString().orEmpty()
                val runnable = Runnable { runSearch(text) }
                pendingSearch = runnable
                debounceHandler.postDelayed(runnable, 350)
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        queryInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH || actionId == EditorInfo.IME_ACTION_DONE) {
                searchButton.performClick(); true
            } else false
        }

        searchButton.setOnClickListener {
            val code = selectedCode
            val query = queryInput.text.toString().trim()
            if (code != null) {
                showDetail(code, detailContainer, statusText)
            } else if (query.isNotEmpty()) {
                // No suggestion picked yet — try the typed text as an exact code first, else run the search again.
                thread {
                    val detail = try { InventoryRepository.fetchProductDetail(query) } catch (e: Exception) { null }
                    runOnUiThread {
                        if (detail != null) renderDetail(detail, detailContainer, statusText)
                        else runSearch(query)
                    }
                }
            } else {
                Toast.makeText(this, "Type a product name or code first", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showDetail(code: String, detailContainer: LinearLayout, statusText: TextView) {
        statusText.text = "Loading details…"
        thread {
            val detail = try { InventoryRepository.fetchProductDetail(code) } catch (e: Exception) { null }
            runOnUiThread {
                if (detail == null) statusText.text = "Couldn't load details for \"$code\""
                else renderDetail(detail, detailContainer, statusText)
            }
        }
    }

    private fun renderDetail(detail: InventoryRepository.ProductDetail, detailContainer: LinearLayout, statusText: TextView) {
        statusText.text = ""
        detailContainer.removeAllViews()
        detailContainer.visibility = View.VISIBLE

        fun addRow(label: String, value: String) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, 10, 0, 10) }
            row.addView(TextView(this).apply { text = label; textSize = 13f; setTextColor(0xFF8A8F98.toInt())
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) })
            row.addView(TextView(this).apply { text = value; textSize = 14f; setTextColor(0xFF1A1C1F.toInt()) })
            detailContainer.addView(row)
        }

        val title = TextView(this).apply {
            text = detail.name; textSize = 17f; setTextColor(0xFF1A1C1F.toInt())
            setPadding(0, 8, 0, 16)
        }
        detailContainer.addView(title)
        addRow("Code", detail.code)
        addRow("Generic", detail.generic.ifEmpty { "—" })
        addRow("Retail Price", InventoryRepository.formatMoney(detail.retailPrice))
        addRow("Quantity", InventoryRepository.formatQty(detail.quantity))
        addRow("Company", detail.company.ifEmpty { "—" })
        addRow("Supplier", detail.supplier.ifEmpty { "—" })
        addRow("Sold — 30 days", "${InventoryRepository.formatQty(detail.qty30)} units")
        addRow("Sold — 60 days", "${InventoryRepository.formatQty(detail.qty60)} units")
        addRow("Sold — 90 days", "${InventoryRepository.formatQty(detail.qty90)} units")
    }
}
