package com.duapharma.closingwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Locale
import kotlin.concurrent.thread

class ClosingWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, ClosingWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            // Show a loading state immediately, then fetch in the background.
            for (id in ids) {
                val loadingViews = RemoteViews(context.packageName, R.layout.widget_closing_summary)
                loadingViews.setTextViewText(R.id.widget_subtitle, context.getString(R.string.widget_loading))
                manager.updateAppWidget(id, loadingViews)
            }

            thread {
                val summary = ClosingRepository.fetchLatestClosing()
                for (id in ids) {
                    val views = buildRemoteViews(context, summary)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, summary: ClosingSummary?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_closing_summary)

            if (summary == null) {
                views.setTextViewText(R.id.widget_subtitle, "Couldn't load closing data")
                views.setTextViewText(R.id.widget_carried_cc, "—")
                views.setTextViewText(R.id.widget_total_deposits, "—")
                views.setTextViewText(R.id.widget_book_bills, "—")
                views.setTextViewText(R.id.widget_manual_returns, "—")
            } else {
                views.setTextViewText(
                    R.id.widget_subtitle,
                    "${summary.date} — Closing ${summary.closingNumber} — ${summary.shift}"
                )
                views.setTextViewText(R.id.widget_carried_cc, ClosingRepository.formatAmount(summary.carriedCC))
                views.setTextViewText(R.id.widget_total_deposits, ClosingRepository.formatAmount(summary.totalDeposits))
                views.setTextViewText(R.id.widget_book_bills, ClosingRepository.formatAmount(summary.bookBills))
                views.setTextViewText(R.id.widget_manual_returns, ClosingRepository.formatAmount(summary.manualReturns))

                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.widget_synced_at, "Synced ${timeFmt.format(java.util.Date())}")
            }

            // Tap anywhere on the widget to force a refresh.
            val refreshIntent = Intent(context, ClosingWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 0, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

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
