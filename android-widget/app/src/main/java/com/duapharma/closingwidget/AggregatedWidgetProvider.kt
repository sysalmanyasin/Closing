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

class AggregatedWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.AGG_ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, AggregatedWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loadingViews = RemoteViews(context.packageName, R.layout.widget_aggregated_final)
                loadingViews.setTextViewText(R.id.agg_subtitle, context.getString(R.string.agg_widget_loading))
                manager.updateAppWidget(id, loadingViews)
            }

            thread {
                val summary = AggregatedRepository.fetchLatestAggregated()
                for (id in ids) {
                    val views = buildRemoteViews(context, summary)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, summary: AggregatedSummary?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_aggregated_final)

            if (summary == null) {
                views.setTextViewText(R.id.agg_subtitle, "Couldn't load closing data")
                views.setTextViewText(R.id.agg_target, "—")
                views.setTextViewText(R.id.agg_predate, "—")
                views.setTextViewText(R.id.agg_cash, "—")
                views.setTextViewText(R.id.agg_variance, "—")
                views.setTextViewText(R.id.agg_variance_label, context.getString(R.string.agg_label_variance))
            } else {
                views.setTextViewText(R.id.agg_subtitle, "${summary.date} — ${summary.shift}")
                views.setTextViewText(R.id.agg_target, AggregatedRepository.formatAmount(summary.targetNetSales))
                views.setTextViewText(R.id.agg_predate, AggregatedRepository.formatAmount(summary.preDateTotal))
                views.setTextViewText(R.id.agg_cash, AggregatedRepository.formatAmount(summary.netCashAvailable))

                views.setTextViewText(R.id.agg_variance_label, summary.varianceLabel)
                views.setTextViewText(R.id.agg_variance, AggregatedRepository.formatAmount(summary.variance))
                // Positive/zero variance reads as healthy (green), a shortfall as a warning (red) —
                // matches the .val.pos / .val.neg convention used by the web app's summary-banner.
                val color = if (summary.variance >= 0) 0xFF7CE38B.toInt() else 0xFFFF8A80.toInt()
                views.setTextColor(R.id.agg_variance, color)

                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.agg_synced_at, "Synced ${timeFmt.format(java.util.Date())}")
            }

            val refreshIntent = Intent(context, AggregatedWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 2, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.agg_widget_root, pendingIntent)

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
