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

class MonthSaleWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.MONTHSALE_ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, MonthSaleWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loadingViews = RemoteViews(context.packageName, R.layout.widget_month_sale)
                loadingViews.setTextViewText(R.id.month_sale_label, context.getString(R.string.month_sale_widget_loading))
                manager.updateAppWidget(id, loadingViews)
            }

            thread {
                val breakdown = MonthSaleRepository.fetchMonthSaleBreakdown()
                for (id in ids) {
                    val views = buildRemoteViews(context, breakdown)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, breakdown: MonthSaleBreakdown?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_month_sale)

            if (breakdown == null) {
                views.setTextViewText(R.id.month_sale_label, "Couldn't load sales data")
                views.setTextViewText(R.id.month_sale_total, "—")
                views.setTextViewText(R.id.month_sale_cash_value, "—")
                views.setTextViewText(R.id.month_sale_banks_value, "—")
                views.setTextViewText(R.id.month_sale_cashbanks_value, "—")
                views.setTextViewText(R.id.month_sale_credit_value, "—")
                views.setTextViewText(R.id.month_sale_customers_value, "—")
                views.setTextViewText(R.id.month_sale_synced_at, "")
            } else {
                views.setTextViewText(R.id.month_sale_label, breakdown.label)
                views.setTextViewText(R.id.month_sale_total, MonthSaleRepository.formatAmount(breakdown.total))
                views.setTextViewText(R.id.month_sale_cash_value, MonthSaleRepository.formatAmount(breakdown.cash))
                views.setTextViewText(R.id.month_sale_banks_value, MonthSaleRepository.formatAmount(breakdown.banks))
                views.setTextViewText(R.id.month_sale_cashbanks_value, MonthSaleRepository.formatAmount(breakdown.cashBanks))
                views.setTextViewText(R.id.month_sale_credit_value, MonthSaleRepository.formatAmount(breakdown.credit))
                views.setTextViewText(R.id.month_sale_customers_value, MonthSaleRepository.formatCount(breakdown.customers))

                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.month_sale_synced_at, "Synced ${timeFmt.format(java.util.Date())}")
            }

            val refreshIntent = Intent(context, MonthSaleWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.month_sale_widget_root, pendingIntent)

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
