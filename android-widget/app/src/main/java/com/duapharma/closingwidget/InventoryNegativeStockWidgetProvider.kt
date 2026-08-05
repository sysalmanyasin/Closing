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

/** Negative Stock — every item with stock < 0, sorted most-negative
    value first. Rendered via a ListView + RemoteViewsService (like
    InventoryReorderWidgetProvider) since the row count isn't capped
    to a small fixed number. */
class InventoryNegativeStockWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVNEGSTOCK_ACTION_REFRESH"
        private const val MAX_ROWS = 200

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryNegativeStockWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = baseRemoteViews(context, id)
                loading.setTextViewText(R.id.inv_sv_empty_view, "Loading…")
                loading.setTextViewText(R.id.inv_sv_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                try {
                    val products = InventoryRepository.fetchAllProducts()
                    val computed = InventoryRepository.computeRows(products)
                    InventoryNegativeStockCache.rows = InventoryRepository.negativeStockRows(computed, MAX_ROWS)
                    InventoryNegativeStockCache.loadFailed = false
                } catch (e: Exception) {
                    InventoryNegativeStockCache.loadFailed = true
                }
                for (id in ids) {
                    val views = baseRemoteViews(context, id)
                    if (InventoryNegativeStockCache.loadFailed) {
                        views.setTextViewText(R.id.inv_sv_empty_view, "Couldn't load inventory data")
                        views.setTextViewText(R.id.inv_sv_footer, "Couldn't load inventory data")
                    } else {
                        views.setTextViewText(R.id.inv_sv_empty_view, "No negative-stock items 🎉")
                        val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                        views.setTextViewText(R.id.inv_sv_footer, "${InventoryNegativeStockCache.rows.size} items · Synced ${timeFmt.format(Date())}")
                    }
                    manager.updateAppWidget(id, views)
                    manager.notifyAppWidgetViewDataChanged(id, R.id.inv_sv_listview)
                }
            }
        }

        private fun baseRemoteViews(context: Context, appWidgetId: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_negative_stock)
            val adapterIntent = Intent(context, InventoryNegativeStockWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = android.net.Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.inv_sv_listview, adapterIntent)
            views.setEmptyView(R.id.inv_sv_listview, R.id.inv_sv_empty_view)

            val refreshIntent = Intent(context, InventoryNegativeStockWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_sv_widget_root, pendingIntent)
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
