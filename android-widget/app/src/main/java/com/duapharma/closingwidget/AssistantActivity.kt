package com.duapharma.closingwidget

import android.app.DatePickerDialog
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.inputmethod.InputMethodManager
import java.util.Calendar
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.concurrent.thread

/** Futuristic Quick Add + Ask Dua, using the same Google/Supabase identity as BT Sales IC. */
class AssistantActivity : AppCompatActivity() {
    private val base = BuildConfig.SUPABASE_URL
    private val anon = BuildConfig.SUPABASE_ANON_KEY
    private val redirectUri = "com.duapharma.closingwidget://auth/callback"
    private var token: String? = null
    private var pendingRequestId: String? = null
    private lateinit var root: LinearLayout
    private var activeContainer: LinearLayout? = null
    private lateinit var screenScroll: ScrollView
    private lateinit var status: TextView
    private lateinit var signInButton: Button
    private lateinit var kind: Spinner
    private lateinit var section: Spinner
    private lateinit var category: Spinner
    private lateinit var staff: Spinner
    private lateinit var shift: Spinner
    private lateinit var date: EditText
    private lateinit var amount: EditText
    private lateinit var description: EditText
    private lateinit var question: EditText
    private lateinit var answer: TextView
    private val sectionIds = mutableListOf<String>()
    private val shownSectionIds = mutableListOf<String>()
    private var pendingAutoAsk = false
    private lateinit var sectionLabel: TextView
    private lateinit var categoryLabel: TextView
    private lateinit var staffLabel: TextView
    private lateinit var shiftLabel: TextView
    private lateinit var creditTypeLabel: TextView
    private lateinit var creditType: Spinner
    private lateinit var monthHint: TextView
    private val categoryIds = mutableListOf<String>()
    private val staffIds = mutableListOf<String>()
    private var sections = JSONObject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(246, 247, 251)
        window.navigationBarColor = Color.rgb(246, 247, 251)
        var flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        if (android.os.Build.VERSION.SDK_INT >= 26) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        window.decorView.systemUiVisibility = flags
        buildScreen()
        if (intent.data == null) restore() else handleOAuthCallback(intent)
        if (savedInstanceState == null) handleLaunchExtras(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data != null) handleOAuthCallback(intent) else handleLaunchExtras(intent)
    }

    private fun handleLaunchExtras(i: Intent) {
        i.getStringExtra("initial_kind")?.let {
            kind.setSelection(when (it) { "expense" -> 1; "credit" -> 2; "custom" -> 3; else -> 0 })
        }
        val prompt = i.getStringExtra("ask_prompt")
        if (prompt != null) {
            question.setText(prompt)
            if (token != null) askDua() else pendingAutoAsk = true
        }
        if (i.getBooleanExtra("focus_ask_dua", false) || prompt != null) {
            screenScroll.post {
                screenScroll.fullScroll(View.FOCUS_DOWN)
                if (prompt == null) {
                    question.requestFocus()
                    (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(question, InputMethodManager.SHOW_IMPLICIT)
                }
            }
        }
    }

    private fun buildScreen() {
        screenScroll = ScrollView(this).apply {
            setBackgroundResource(R.drawable.bg_app_light)
            isFillViewport = true
            clipToPadding = false
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(32))
        }
        screenScroll.addView(root)
        setContentView(screenScroll)

        val eyebrow = text("BT  /  SALES INTELLIGENCE", 11f, true, Color.rgb(15, 159, 143))
        eyebrow.letterSpacing = 0.13f
        text("Your business.\nOne conversation.", 30f, true, Color.rgb(16, 24, 40)).apply {
            setPadding(0, dp(8), 0, dp(5))
        }
        text("QUICK ACTIONS  ·  LIVE BUSINESS DATA", 11f, true, Color.rgb(102, 112, 133))
        spacer(16)

        card {
            text("SECURE SESSION", 11f, true, Color.rgb(102, 112, 133))
            status = text("Connect your Google account to continue.", 14f, false, Color.rgb(29, 41, 57))
            signInButton = button("Continue with Google", R.drawable.bg_button_accent_light) { startGoogleSignIn() }
            text("Uses your authorized BT Sale Data identity. No separate password.", 12f, false, Color.rgb(152, 162, 179))
        }

        spacer(14)
        card {
            rowTitle("01", "Quick Add", "FAST · VERIFIED WRITES", Color.rgb(15, 159, 143))
            text("Same four destinations as Quick Add in BT Sale Data.", 13f, false, Color.rgb(102, 112, 133))
            kind = spinner(listOf("📒 Jazz Cash", "🧾 Expenses / Patty", "👥 Staff Credit", "＋ New Section"))
            date = field("Date", InputType.TYPE_NULL).apply {
                setText(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))
                isFocusable = false
                isClickable = true
                setOnClickListener { pickDate() }
            }
            monthHint = text("", 11f, false, Color.rgb(15, 159, 143))
            sectionLabel = label("SECTION")
            section = spinner(emptyList())
            categoryLabel = label("CATEGORY")
            category = spinner(emptyList())
            staffLabel = label("STAFF MEMBER")
            staff = spinner(emptyList())
            creditTypeLabel = label("TYPE")
            creditType = spinner(listOf("Credit given", "Deduction (−)"))
            shiftLabel = label("SHIFT")
            shift = spinner(listOf("No shift", "Morning", "Evening", "Night", "Both", "Off"))
            amount = field("Amount (PKR)", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
            description = field("Short description", InputType.TYPE_CLASS_TEXT)
            button("＋   Save entry securely", R.drawable.bg_button_accent_light) { submitEntry() }

            kind.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) {}
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    applyKind(position)
                }
            }
            section.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onNothingSelected(parent: AdapterView<*>?) {}
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                    populateCategories(position)
                }
            }
        }

        spacer(14)
        card {
            rowTitle("02", "Ask Dua", "READ-ONLY AI", Color.rgb(109, 74, 255))
            text("Ask in plain language. Dua uses the same BT Sales IC AI provider pool and live business context, without write tools.", 13f, false, Color.rgb(102, 112, 133))
            question = field("e.g. What were this month's expenses?", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE).apply {
                minLines = 2
                gravity = Gravity.TOP or Gravity.START
            }
            button("✦   Ask Dua", R.drawable.bg_button_violet_light) { askDua() }
            answer = text("Your answer will appear here.", 14f, false, Color.rgb(29, 41, 57))
            answer.setTextIsSelectable(true)
            answer.setPadding(dp(12), dp(12), dp(12), dp(12))
            answer.background = resources.getDrawable(R.drawable.bg_answer_light, theme)
        }

        kind.setSelection(0)
    }

    private fun card(content: LinearLayout.() -> Unit) {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = resources.getDrawable(R.drawable.bg_card_light, theme)
        }
        root.addView(panel, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(2) })
        val previous = activeContainer
        activeContainer = panel
        panel.content()
        activeContainer = previous
    }

    private fun rowTitle(number: String, title: String, tag: String, accent: Int) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val numberView = TextView(this).apply {
            text = number
            textSize = 12f
            setTextColor(accent)
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            background = resources.getDrawable(R.drawable.bg_number_chip_light, theme)
            setPadding(dp(10), dp(7), dp(10), dp(7))
        }
        row.addView(numberView)
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(10), 0, 0, 0) }
        titles.addView(TextView(this).apply {
            text = title; textSize = 20f; setTextColor(Color.rgb(16, 24, 40)); setTypeface(null, android.graphics.Typeface.BOLD)
        })
        titles.addView(TextView(this).apply {
            text = tag; textSize = 9f; letterSpacing = 0.1f; setTextColor(accent)
        })
        row.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        row.addView(TextView(this).apply {
            text = "●"; textSize = 11f; setTextColor(accent)
        })
        target().addView(row, LinearLayout.LayoutParams(-1, -2))
        spacer(12)
    }

    private fun text(value: String, size: Float, bold: Boolean = false, color: Int = Color.rgb(16, 24, 40)): TextView {
        val view = TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            setPadding(0, dp(4), 0, dp(4))
            if (bold) setTypeface(null, android.graphics.Typeface.BOLD)
        }
        target().addView(view, LinearLayout.LayoutParams(-1, -2))
        return view
    }

    private fun label(value: String): TextView =
        text(value, 10f, true, Color.rgb(102, 112, 133)).apply { letterSpacing = 0.08f; setPadding(0, dp(10), 0, dp(2)) }

    private fun show(visible: Boolean, vararg views: View) {
        views.forEach { it.visibility = if (visible) View.VISIBLE else View.GONE }
    }

    private fun applyKind(position: Int) {
        val credit = position == 2
        show(position == 3, sectionLabel, section)
        show(!credit, categoryLabel, category)
        show(credit, staffLabel, staff, creditTypeLabel, creditType)
        show(position == 0, shiftLabel, shift)
        updateMonthHint()
        if (!credit && sectionIds.isNotEmpty()) refillSections(position)
    }

    private fun refillSections(position: Int) {
        shownSectionIds.clear()
        when (position) {
            0 -> shownSectionIds.add("jazzcash")
            1 -> shownSectionIds.add("expense")
            else -> shownSectionIds.addAll(sectionIds.filter { it != "jazzcash" && it != "expense" })
        }
        val labels = shownSectionIds.map { sections.optJSONObject(it)?.optString("label", it) ?: it }
        section.adapter = darkAdapter(labels)
        populateCategories(0)
        if (position == 3 && shownSectionIds.isEmpty()) {
            status.text = "No custom sections yet. Create one in BT Sale Data → Manager → C. Misc Sections."
        }
    }

    private fun pickDate() {
        val cal = Calendar.getInstance()
        runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(date.text.toString())?.let { cal.time = it } }
        DatePickerDialog(this, { _, y, m, d ->
            date.setText(String.format(Locale.US, "%04d-%02d-%02d", y, m + 1, d))
            updateMonthHint()
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun monthLabelOf(isoDate: String): String = runCatching {
        SimpleDateFormat("MMMM yyyy", Locale.US).format(SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(isoDate)!!)
    }.getOrDefault("")

    private fun updateMonthHint() {
        val credit = kind.selectedItemPosition == 2
        monthHint.text = if (credit) "Filed under " + monthLabelOf(date.text.toString()) + " staff credit" else ""
        monthHint.visibility = if (credit) View.VISIBLE else View.GONE
    }

    private fun refreshWidgets() {
        val app = applicationContext
        QuickActionsWidgetProvider.updateAll(app)
        // The ledger folds inbox rows into the shared payload a few seconds later; refresh the total again then.
        Handler(Looper.getMainLooper()).postDelayed({ QuickActionsWidgetProvider.updateAll(app) }, 8000)
    }

    private fun field(hintText: String, type: Int): EditText {
        return EditText(this).apply {
            hint = hintText
            inputType = type
            textSize = 14f
            setTextColor(Color.rgb(16, 24, 40))
            setHintTextColor(Color.rgb(152, 162, 179))
            background = resources.getDrawable(R.drawable.bg_input_light, theme)
            setPadding(dp(13), dp(11), dp(13), dp(11))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(5); bottomMargin = dp(6) }
            target().addView(this)
        }
    }

    private fun darkAdapter(items: List<String>): ArrayAdapter<String> =
        object : ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, items) {
            override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View =
                (super.getView(position, convertView, parent) as TextView).apply {
                    setTextColor(Color.rgb(16, 24, 40))
                    textSize = 14f
                    setPadding(dp(10), dp(4), dp(10), dp(4))
                }
            override fun getDropDownView(position: Int, convertView: View?, parent: android.view.ViewGroup): View =
                (super.getDropDownView(position, convertView, parent) as TextView).apply {
                    setTextColor(Color.rgb(16, 24, 40))
                    setBackgroundColor(Color.WHITE)
                    textSize = 14f
                    setPadding(dp(12), dp(12), dp(12), dp(12))
                }
        }.also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }

    private fun spinner(items: List<String>): Spinner = Spinner(this).apply {
        adapter = darkAdapter(items)
        background = resources.getDrawable(R.drawable.bg_spinner_light, theme)
        setPadding(dp(8), dp(4), dp(36), dp(4))
        layoutParams = LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(5); bottomMargin = dp(5) }
        target().addView(this)
    }

    private fun button(value: String, backgroundId: Int, click: () -> Unit): Button {
        return Button(this).apply {
            text = value
            textSize = 14f
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = resources.getDrawable(backgroundId, theme)
            setPadding(dp(14), dp(10), dp(14), dp(10))
            elevation = dp(2).toFloat()
            setOnClickListener { click() }
            layoutParams = LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(8); bottomMargin = dp(8) }
            target().addView(this)
        }
    }

    private fun target(): LinearLayout = activeContainer ?: root
    private fun spacer(height: Int) { target().addView(View(this), LinearLayout.LayoutParams(1, dp(height))) }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun prefs() = AssistantStore.prefs(applicationContext)

    private fun startGoogleSignIn() {
        val verifierBytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.encodeToString(verifierBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val challenge = Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        val state = UUID.randomUUID().toString()
        prefs().edit().putString("pkce_verifier", verifier).putString("oauth_state", state).apply()
        val url = base + "/auth/v1/authorize?provider=google" +
            "&redirect_to=" + enc(redirectUri) +
            "&code_challenge=" + enc(challenge) +
            "&code_challenge_method=s256" +
            "&state=" + enc(state)
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            status.text = "Finish Google sign-in in your browser, then return here."
            signInButton.text = "Continue with Google"
        } catch (_: Exception) {
            status.text = "Could not open Google sign-in. Check that a browser is installed."
        }
    }

    private fun handleOAuthCallback(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "com.duapharma.closingwidget" || uri.host != "auth" || uri.path != "/callback") return
        val error = uri.getQueryParameter("error_description") ?: uri.getQueryParameter("error")
        if (!error.isNullOrBlank()) {
            status.text = "Google sign-in failed: " + error.take(160)
            return
        }
        val code = uri.getQueryParameter("code")
        val returnedState = uri.getQueryParameter("state")
        val savedState = prefs().getString("oauth_state", null)
        val verifier = prefs().getString("pkce_verifier", null)
        if (code.isNullOrBlank() || verifier.isNullOrBlank() ||
            (!returnedState.isNullOrBlank() && returnedState != savedState)) {
            status.text = "Sign-in callback could not be verified. Please try again."
            return
        }
        status.text = "Completing secure Google sign-in…"
        thread {
            val pair = tokenRequest("/auth/v1/token?grant_type=pkce",
                JSONObject().put("auth_code", code).put("code_verifier", verifier))
            runOnUiThread {
                prefs().edit().remove("pkce_verifier").remove("oauth_state").apply()
                if (pair == null) {
                    status.text = "Google sign-in could not be completed. Check Supabase's allowed redirect URLs."
                    return@runOnUiThread
                }
                token = pair.first
                prefs().edit().putString("refresh", pair.second).apply()
                status.text = "Checking BT Sale Data authorization…"
                loadMetadata()
            }
        }
    }

    private fun restore() {
        val refresh = prefs().getString("refresh", null) ?: return
        status.text = "Restoring secure session…"
        thread {
            val pair = tokenRequest("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", refresh))
            runOnUiThread {
                if (pair != null) {
                    token = pair.first
                    prefs().edit().putString("refresh", pair.second).apply()
                    loadMetadata()
                } else {
                    status.text = "Session expired. Continue with Google to reconnect."
                    prefs().edit().remove("refresh").apply()
                }
            }
        }
    }

    private fun enc(value: String) = URLEncoder.encode(value, "UTF-8")

    private fun tokenRequest(path: String, body: JSONObject): Pair<String, String>? {
        val connection = URL(base + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 12000
            connection.readTimeout = 20000
            connection.setRequestProperty("apikey", anon)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            if (connection.responseCode !in 200..299) return null
            val result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val access = result.optString("access_token")
            val refresh = result.optString("refresh_token")
            if (access.isBlank() || refresh.isBlank()) null else access to refresh
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    private fun api(body: JSONObject): JSONObject {
        val connection = URL(base + "/functions/v1/android-assistant").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.connectTimeout = 12000
            connection.readTimeout = 60000
            connection.setRequestProperty("apikey", anon)
            connection.setRequestProperty("Authorization", "Bearer " + (token ?: throw IllegalStateException("Sign in with Google first")))
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val result = JSONObject(stream?.bufferedReader()?.use { it.readText() } ?: "{}")
            if (connection.responseCode !in 200..299) throw IllegalStateException(result.optString("error", "Request failed"))
            return result
        } finally { connection.disconnect() }
    }

    private fun loadMetadata() {
        thread {
            try {
                val result = api(JSONObject().put("action", "metadata"))
                val sectionObject = result.optJSONObject("sections") ?: JSONObject()
                val ids = mutableListOf<String>()
                val names = mutableListOf<String>()
                val keys = sectionObject.keys()
                while (keys.hasNext()) {
                    val id = keys.next()
                    ids.add(id)
                    names.add(sectionObject.optJSONObject(id)?.optString("label", id) ?: id)
                }
                val staffArray = result.optJSONArray("staff") ?: JSONArray()
                val newStaffIds = mutableListOf<String>()
                val staffNames = mutableListOf<String>()
                for (i in 0 until staffArray.length()) {
                    val row = staffArray.optJSONObject(i) ?: continue
                    newStaffIds.add(row.optString("id"))
                    staffNames.add(row.optString("name"))
                }
                runOnUiThread {
                    sections = sectionObject
                    sectionIds.clear(); sectionIds.addAll(ids)
                    staffIds.clear(); staffIds.addAll(newStaffIds)
                    staff.adapter = darkAdapter(staffNames)
                    applyKind(kind.selectedItemPosition)
                    status.text = "Authorized · Google session active"
                    signInButton.text = "Google account connected ✓"
                    if (pendingAutoAsk) { pendingAutoAsk = false; askDua() }
                }
            } catch (error: Exception) {
                runOnUiThread {
                    status.text = error.message ?: "This Google account is not authorized."
                    token = null
                    prefs().edit().remove("refresh").apply()
                }
            }
        }
    }

    private fun populateCategories(position: Int) {
        val sectionId = shownSectionIds.getOrNull(position) ?: return
        val rows = sections.optJSONObject(sectionId)?.optJSONArray("categories") ?: JSONArray()
        categoryIds.clear()
        val labels = mutableListOf<String>()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            categoryIds.add(row.optString("id"))
            labels.add(row.optString("label"))
        }
        category.adapter = darkAdapter(labels)
    }

    private fun submitEntry() {
        if (token == null) { status.text = "Continue with Google first."; return }
        val raw = amount.text.toString().toDoubleOrNull()
        if (raw == null || raw <= 0 || description.text.toString().isBlank()) {
            status.text = "Enter a positive amount and description."
            return
        }
        val position = kind.selectedItemPosition
        val creditMode = position == 2
        val value = if (creditMode && creditType.selectedItemPosition == 1) -raw else raw
        val desc = description.text.toString().trim()
        if (pendingRequestId == null) pendingRequestId = UUID.randomUUID().toString()
        val body = JSONObject().put("action", "quick_add").put("requestId", pendingRequestId)
            .put("kind", if (creditMode) "credit" else "ledger")
            .put("date", date.text.toString().trim()).put("amount", value)
            .put("description", desc)
        val title: String
        val detail: String
        if (creditMode) {
            val index = staff.selectedItemPosition
            if (index !in staffIds.indices) { status.text = "Choose an active staff member."; return }
            body.put("staffId", staffIds[index])
            title = "Staff · " + staff.selectedItem.toString()
            detail = monthLabelOf(date.text.toString()) + " · " + desc
        } else {
            val ledgerType = shownSectionIds.getOrNull(if (position == 3) section.selectedItemPosition else 0)
            val categoryId = categoryIds.getOrNull(category.selectedItemPosition)
            if (ledgerType == null || categoryId == null) { status.text = "Choose a valid section and category."; return }
            body.put("ledgerType", ledgerType).put("categoryId", categoryId)
            if (ledgerType == "jazzcash" && shift.selectedItemPosition > 0) body.put("shift", shift.selectedItem.toString())
            val sectionName = when (position) { 0 -> "Jazz Cash"; 1 -> "Expenses"; else -> section.selectedItem?.toString() ?: "Section" }
            title = sectionName + " · " + (category.selectedItem?.toString() ?: "")
            detail = desc
        }
        status.text = "Saving securely…"
        thread {
            try {
                val result = api(body)
                runOnUiThread {
                    status.text = result.optString("message", "Entry saved.")
                    pendingRequestId = null
                    amount.text.clear()
                    description.text.clear()
                    AssistantStore.addEntry(applicationContext, AssistantStore.Entry(title, detail, value, System.currentTimeMillis(), position))
                    refreshWidgets()
                }
            } catch (error: Exception) {
                runOnUiThread { status.text = error.message ?: "Entry was not confirmed. Check the ledger before retrying." }
            }
        }
    }

    private fun askDua() {
        if (token == null) { answer.text = "Continue with Google to ask Dua."; return }
        val query = question.text.toString().trim()
        if (query.isBlank()) { answer.text = "Type a question first."; return }
        answer.text = "✦  Dua is checking your live business records…"
        thread {
            try {
                val result = api(JSONObject().put("action", "ask_dua").put("question", query))
                val text = result.optString("answer", "No answer returned.")
                AssistantStore.saveAnswer(applicationContext, query, text)
                AskDuaWidgetProvider.updateAll(applicationContext)
                runOnUiThread {
                    answer.text = text + "\n\n" + "READ-ONLY  ·  " + result.optString("provider", "BT Sales IC AI")
                }
            } catch (error: Exception) {
                runOnUiThread { answer.text = error.message ?: "Ask Dua is unavailable." }
            }
        }
    }
}
