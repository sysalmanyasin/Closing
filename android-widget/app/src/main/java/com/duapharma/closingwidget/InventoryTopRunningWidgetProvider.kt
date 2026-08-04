package com.duapharma.closingwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/** Widget 5 — Top Running Items, value-wise (Top 10, 30D — same default toggle
    state as BT Sale Data's Cover page "Top Running Items" card). */
class InventoryTopRunningWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVTOPRUNNING_ACTION_REFRESH"
        private const val TOP_N = 10
        private const val WINDOW_DAYS = 30

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryTopRunningWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_inventory_top_running)
                loading.setTextViewText(R.id.inv_top_running_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                val rows = try {
                    val products = InventoryRepository.fetchAllProducts()
                    InventoryRepository.topSellers(products, WINDOW_DAYS, TOP_N, true)
                } catch (e: Exception) { null }
                for (id in ids) manager.updateAppWidget(id, buildRemoteViews(context, rows))
            }
        }

        private fun buildRemoteViews(context: Context, rows: List<InventoryRepository.SellerRow>?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_top_running)
            views.removeAllViews(R.id.inv_top_running_list_container)

            if (rows == null) {
                views.setTextViewText(R.id.inv_top_running_footer, "Couldn't load inventory data")
            } else {
                rows.forEachIndexed { i, r ->
                    val rowView = RemoteViews(context.packageName, R.layout.widget_inventory_top_running_row)
                    rowView.setTextViewText(R.id.inv_run_row_rank, (i + 1).toString())
                    rowView.setTextViewText(R.id.inv_run_row_name, r.name)
                    rowView.setTextViewText(R.id.inv_run_row_sub, "${InventoryRepository.formatQty(r.saleQty)} units sold")
                    rowView.setTextViewText(R.id.inv_run_row_value, InventoryRepository.formatMoney(r.saleValue))
                    views.addView(R.id.inv_top_running_list_container, rowView)
                }
                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.inv_top_running_footer, "Top $TOP_N · 30D · Synced ${timeFmt.format(Date())}")
            }

            val refreshIntent = Intent(context, InventoryTopRunningWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_top_running_widget_root, pendingIntent)
            return views
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        refreshWidgets(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) updateAllWidgets(context)
    }
}
