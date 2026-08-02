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
                loadingViews.setTextViewText(R.id.widget_date_staff, context.getString(R.string.widget_loading))
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
                views.setTextViewText(R.id.widget_date_staff, "Couldn't load closing data")
                views.setTextViewText(R.id.widget_shift_badge, "—")
                views.setTextViewText(R.id.widget_net_sale, "—")
                views.setTextViewText(R.id.widget_net_cash, "—")
                views.setTextViewText(R.id.widget_total_cash, "—")
            } else {
                views.setTextViewText(R.id.widget_date_staff, "${summary.date} · ${summary.staff}")
                views.setTextViewText(R.id.widget_shift_badge, summary.shift)
                views.setTextViewText(R.id.widget_net_sale, ClosingRepository.formatAmount(summary.netSale))
                views.setTextViewText(R.id.widget_net_cash, ClosingRepository.formatAmount(summary.netCash))
                views.setTextViewText(R.id.widget_total_cash, ClosingRepository.formatAmount(summary.totalCash))

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
