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

class StaffCreditWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.STAFFCREDIT_ACTION_REFRESH"

        /* RemoteViews has no dynamic max-row constraint like a ListView would —
           cap it so a very large roster doesn't render a widget taller than any
           launcher can reasonably host. Widen with resizeMode if this is hit. */
        private const val MAX_ROWS = 20

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, StaffCreditWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loadingViews = RemoteViews(context.packageName, R.layout.widget_staff_credit)
                loadingViews.setTextViewText(R.id.staff_credit_label, context.getString(R.string.staff_credit_widget_loading))
                manager.updateAppWidget(id, loadingViews)
            }

            thread {
                val summary = CreditRepository.fetchCreditSummary()
                for (id in ids) {
                    val views = buildRemoteViews(context, summary)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, summary: CreditRepository.CreditSummary?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_staff_credit)
            views.removeAllViews(R.id.staff_credit_list_container)

            if (summary == null) {
                views.setTextViewText(R.id.staff_credit_label, "Couldn't load credit data")
                views.setTextViewText(R.id.staff_credit_total_value, "—")
                views.setTextViewText(R.id.staff_credit_synced_at, "")
            } else {
                views.setTextViewText(R.id.staff_credit_label, "Staff Credit — ${summary.monthLabel}")

                summary.staffRows.take(MAX_ROWS).forEach { row ->
                    val rowView = RemoteViews(context.packageName, R.layout.widget_staff_credit_row)
                    rowView.setTextViewText(R.id.staff_row_srnum, row.srNum.toString())
                    rowView.setTextViewText(R.id.staff_row_name, row.name)
                    rowView.setTextViewText(R.id.staff_row_amount, CreditRepository.formatAmount(row.amount))
                    views.addView(R.id.staff_credit_list_container, rowView)
                }
                if (summary.staffRows.size > MAX_ROWS) {
                    val moreView = RemoteViews(context.packageName, R.layout.widget_staff_credit_row)
                    moreView.setTextViewText(R.id.staff_row_srnum, "")
                    moreView.setTextViewText(R.id.staff_row_name, "+ ${summary.staffRows.size - MAX_ROWS} more — open Closing app")
                    moreView.setTextViewText(R.id.staff_row_amount, "")
                    views.addView(R.id.staff_credit_list_container, moreView)
                }

                views.setTextViewText(R.id.staff_credit_total_value, CreditRepository.formatAmount(summary.staffCreditTotal))

                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.staff_credit_synced_at, "Synced ${timeFmt.format(java.util.Date())}")
            }

            val refreshIntent = Intent(context, StaffCreditWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.staff_credit_widget_root, pendingIntent)

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
