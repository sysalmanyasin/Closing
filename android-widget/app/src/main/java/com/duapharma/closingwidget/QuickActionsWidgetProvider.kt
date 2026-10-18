package com.duapharma.closingwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Quick Add widget: live total credit (same number as the Total Credit widget),
 * four quick-add buttons (Jazz Cash / Staff Credit / Expense / New Section)
 * and the last 3 entries saved from the app/widget.
 */
class QuickActionsWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.QUICKACTIONS_REFRESH"

        private data class RowIds(val root: Int, val dot: Int, val title: Int, val meta: Int, val amount: Int)

        // Jazz Cash, Expenses, Staff Credit, Custom section
        private val KIND_COLORS = intArrayOf(
            Color.parseColor("#8B8EFF"), Color.parseColor("#FFB84D"),
            Color.parseColor("#22E5D3"), Color.parseColor("#FF6B9A")
        )
        private val BAR_IDS = intArrayOf(R.id.qa_bar1, R.id.qa_bar2, R.id.qa_bar3, R.id.qa_bar4)
        private val LEG_IDS = intArrayOf(R.id.qa_leg1, R.id.qa_leg2, R.id.qa_leg3, R.id.qa_leg4)
        private val LEG_NAMES = arrayOf("Staff", "Jazz", "Patty", "Misc")

        private fun short(v: Double): String {
            val a = Math.abs(v)
            val sign = if (v < 0) "-" else ""
            return sign + when {
                a >= 1_000_000 -> String.format(Locale.US, "%.1fM", a / 1_000_000)
                a >= 1_000 -> Math.round(a / 1_000).toString() + "K"
                else -> Math.round(a).toString()
            }
        }
        private val ROWS = listOf(
            RowIds(R.id.qa_row1, R.id.qa_row1_dot, R.id.qa_row1_title, R.id.qa_row1_meta, R.id.qa_row1_amount),
            RowIds(R.id.qa_row2, R.id.qa_row2_dot, R.id.qa_row2_title, R.id.qa_row2_meta, R.id.qa_row2_amount),
            RowIds(R.id.qa_row3, R.id.qa_row3_dot, R.id.qa_row3_title, R.id.qa_row3_meta, R.id.qa_row3_amount),
        )

        /** Redraws from cache instantly, then re-fetches the total in the background. */
        fun updateAll(context: Context) {
            val app = context.applicationContext
            thread { updateNow(app) }
        }

        private fun ids(context: Context): IntArray =
            AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, QuickActionsWidgetProvider::class.java))

        fun updateNow(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = ids(context)
            if (ids.isEmpty()) return
            render(context, manager, ids, "Refreshing…")
            val summary = try { CreditRepository.fetchCreditSummary(context) } catch (_: Exception) { null }
            if (summary != null) AssistantStore.saveSummary(
                context, summary.totalOutstanding,
                listOf(summary.staffCreditTotal, summary.jazzCashTotal, summary.pattyExpensesTotal, summary.miscSectionsTotal)
            )
            render(context, manager, ids, null)
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray, note: String?) {
            val views = RemoteViews(context.packageName, R.layout.widget_quick_actions)

            val total = AssistantStore.total(context)
            views.setTextViewText(R.id.qa_total, if (total == null) "₨—" else CreditRepository.formatAmount(total.first))
            views.setTextViewText(
                R.id.qa_updated,
                note ?: if (total == null) "Tap to refresh"
                else "Updated " + SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(total.second))
            )

            // Split bar: cumulative, so each bar is drawn over the previous one (Staff, Jazz, Patty, Misc).
            val parts = AssistantStore.parts(context)
            val positive = parts?.map { Math.max(0.0, it) } ?: listOf(0.0, 0.0, 0.0, 0.0)
            val sum = positive.sum()
            var running = 0.0
            for (i in 0 until 4) {
                running += positive[i]
                val progress = if (sum > 0) Math.round(running / sum * 1000).toInt() else 0
                views.setProgressBar(BAR_IDS[i], 1000, progress, false)
                views.setTextViewText(LEG_IDS[i], "● " + LEG_NAMES[i] + (if (parts != null) " " + short(parts[i]) else ""))
            }

            val timeFmt = SimpleDateFormat("d MMM, h:mm a", Locale.getDefault())
            val entries = AssistantStore.recent(context)
            ROWS.forEachIndexed { i, row ->
                val e = entries.getOrNull(i)
                if (e == null) {
                    views.setViewVisibility(row.root, View.GONE)
                } else {
                    views.setViewVisibility(row.root, View.VISIBLE)
                    views.setTextViewText(row.title, e.title)
                    views.setTextViewText(row.meta, e.detail + " · " + timeFmt.format(Date(e.ts)))
                    views.setTextViewText(row.amount, CreditRepository.formatAmount(e.amount))
                    val color = KIND_COLORS[e.kind.coerceIn(0, 3)]
                    views.setTextColor(row.dot, color)
                    views.setTextColor(row.amount, color)
                }
            }
            views.setViewVisibility(R.id.qa_empty, if (entries.isEmpty()) View.VISIBLE else View.GONE)

            views.setOnClickPendingIntent(R.id.quick_add_action, launch(context, "jazzcash", 4101))
            views.setOnClickPendingIntent(R.id.add_credit_action, launch(context, "credit", 4102))
            views.setOnClickPendingIntent(R.id.add_expense_action, launch(context, "expense", 4103))
            views.setOnClickPendingIntent(R.id.add_section_action, launch(context, "custom", 4104))
            val refresh = Intent(context, QuickActionsWidgetProvider::class.java).setAction(ACTION_REFRESH)
            views.setOnClickPendingIntent(
                R.id.qa_header,
                PendingIntent.getBroadcast(context, 4100, refresh, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            )
            manager.updateAppWidget(ids, views)
        }

        private fun launch(context: Context, kind: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, AssistantActivity::class.java).putExtra("initial_kind", kind)
            return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread { try { updateNow(context.applicationContext) } finally { pending.finish() } }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            val pending = goAsync()
            thread { try { updateNow(context.applicationContext) } finally { pending.finish() } }
        }
    }
}

/** Ask Dua widget: last answer preview, three one-tap questions, and a button to open the full screen. */
class AskDuaWidgetProvider : AppWidgetProvider() {

    companion object {
        fun updateAll(context: Context) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val ids = manager.getAppWidgetIds(ComponentName(app, AskDuaWidgetProvider::class.java))
            if (ids.isNotEmpty()) thread { render(app, manager, ids) }
        }

        private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val views = RemoteViews(context.packageName, R.layout.widget_ask_dua)
            AssistantStore.lastAnswer(context)?.let { (q, a) ->
                views.setTextViewText(R.id.dua_question, "You asked: $q")
                views.setTextViewText(R.id.dua_answer, a)
            }
            views.setOnClickPendingIntent(R.id.ask_dua_open, open(context, null, 4201))
            views.setOnClickPendingIntent(R.id.dua_panel, open(context, null, 4201))
            views.setOnClickPendingIntent(R.id.dua_chip_sales, open(context, "What were today's sales?", 4202))
            views.setOnClickPendingIntent(R.id.dua_chip_expenses, open(context, "What were this month's expenses?", 4203))
            views.setOnClickPendingIntent(R.id.dua_chip_credit, open(context, "What is the total outstanding credit right now, split by section?", 4204))
            manager.updateAppWidget(ids, views)
        }

        private fun open(context: Context, prompt: String?, requestCode: Int): PendingIntent {
            val intent = Intent(context, AssistantActivity::class.java).putExtra("focus_ask_dua", true)
            if (prompt != null) intent.putExtra("ask_prompt", prompt)
            return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        thread { try { render(context.applicationContext, manager, ids) } finally { pending.finish() } }
    }
}
