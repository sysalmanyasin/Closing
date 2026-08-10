package com.duapharma.closingwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Locale
import kotlin.concurrent.thread

class SectionSummaryWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.SECTIONSUMMARY_ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, SectionSummaryWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loadingViews = RemoteViews(context.packageName, R.layout.widget_section_summary)
                loadingViews.setTextViewText(R.id.section_summary_label, context.getString(R.string.section_summary_widget_loading))
                manager.updateAppWidget(id, loadingViews)
            }

            thread {
                val summary = CreditRepository.fetchCreditSummary(context)
                for (id in ids) {
                    val views = buildRemoteViews(context, summary)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, summary: CreditRepository.CreditSummary?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_section_summary)

            if (summary == null) {
                views.setTextViewText(R.id.section_summary_label, "Couldn't load credit data")
                views.setTextViewText(R.id.section_staff_credit_value, "—")
                views.setTextViewText(R.id.section_jazz_cash_value, "—")
                views.setTextViewText(R.id.section_patty_expenses_value, "—")
                views.setTextViewText(R.id.section_misc_sections_value, "—")
                views.setTextViewText(R.id.section_total_value, "—")
                views.setTextViewText(R.id.section_summary_synced_at, "")
            } else {
                views.setTextViewText(R.id.section_summary_label, "Staff Credit shown for ${summary.monthLabel} · rest all-time")
                views.setTextViewText(R.id.section_staff_credit_value, CreditRepository.formatAmount(summary.staffCreditTotal))
                views.setTextViewText(R.id.section_jazz_cash_value, CreditRepository.formatAmount(summary.jazzCashTotal))
                views.setTextViewText(R.id.section_patty_expenses_value, CreditRepository.formatAmount(summary.pattyExpensesTotal))
                views.setTextViewText(R.id.section_misc_sections_value, CreditRepository.formatAmount(summary.miscSectionsTotal))
                views.setTextViewText(R.id.section_total_value, CreditRepository.formatAmount(summary.totalOutstanding))

                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.section_summary_synced_at, "Synced ${timeFmt.format(java.util.Date())}")
            }

            val refreshIntent = Intent(context, SectionSummaryWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.section_summary_widget_root, pendingIntent)

            return views
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        refreshWidgets(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            updateAllWidgets(context)
        }
    }
}
