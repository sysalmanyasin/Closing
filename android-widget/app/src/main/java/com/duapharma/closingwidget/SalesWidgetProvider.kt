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
import kotlin.math.roundToInt

class SalesWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.SALES_ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, SalesWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loadingViews = RemoteViews(context.packageName, R.layout.widget_sales_summary)
                loadingViews.setTextViewText(R.id.sales_latest_label, context.getString(R.string.sales_widget_loading))
                manager.updateAppWidget(id, loadingViews)
            }

            thread {
                val summary = SalesRepository.fetchSalesSummary(context)
                for (id in ids) {
                    val views = buildRemoteViews(context, summary)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, summary: SalesSummary?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_sales_summary)

            if (summary == null) {
                views.setTextViewText(R.id.sales_latest_label, "Couldn't load sales data")
                views.setTextViewText(R.id.sales_latest_total, "—")
                views.setTextViewText(R.id.sales_change_pct, "")
                views.setTextViewText(R.id.sales_target_label, "")
                views.setTextViewText(R.id.sales_target_pct, "—")
                views.setTextViewText(R.id.sales_pace_detail, "")
            } else {
                views.setTextViewText(R.id.sales_latest_label, "Latest Sale — ${summary.latestDateLabel}")
                views.setTextViewText(R.id.sales_latest_total, SalesRepository.formatAmount(summary.latestTotal))

                if (summary.changePct != null) {
                    val arrow = if (summary.changePct >= 0) "▲" else "▼"
                    val color = if (summary.changePct >= 0) 0xFF2E9E4F.toInt() else 0xFFD64541.toInt()
                    val pctText = "$arrow ${SalesRepository.formatPct(kotlin.math.abs(summary.changePct.roundToInt().toDouble()))}"
                    views.setTextViewText(R.id.sales_change_pct, pctText)
                    views.setTextColor(R.id.sales_change_pct, color)
                } else {
                    views.setTextViewText(R.id.sales_change_pct, "")
                }

                views.setTextViewText(R.id.sales_target_label, "${summary.monthLabel} — Target Pace")
                views.setTextViewText(
                    R.id.sales_target_pct,
                    "${SalesRepository.formatPct(summary.pctOfTarget.roundToInt().toDouble())} of target"
                )

                val aheadLabel = if (summary.aheadOfPace >= 0) "ahead of pace" else "behind pace"
                val paceDetail = "${SalesRepository.formatAmount(kotlin.math.abs(summary.aheadOfPace))} $aheadLabel · " +
                    "Day ${summary.daysEntered}/${summary.daysInMonth} entered · " +
                    "${SalesRepository.formatAmount(summary.perDayPace)}/day needed"
                views.setTextViewText(R.id.sales_pace_detail, paceDetail)

                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.sales_synced_at, "Synced ${timeFmt.format(java.util.Date())}")
            }

            val refreshIntent = Intent(context, SalesWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.sales_widget_root, pendingIntent)

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
