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

/** Widget 3 — "Reorder Now — Most Urgent" list, fixed at the same 30D
    window / <7D cover toggle state shown in BT Sale Data's Cover page.
    Rendered via a ListView + RemoteViewsService (InventoryReorderWidgetService)
    so an arbitrary number of rows (currently ~56) never risks the
    TransactionTooLargeException that manually stacking that many rows
    into one RemoteViews would hit. */
class InventoryReorderWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVREORDER_ACTION_REFRESH"
        private const val WINDOW_DAYS = 30
        private const val COVER_THRESHOLD = 7.0
        private const val MAX_ROWS = 300 // generous cap; real data is currently ~56

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryReorderWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = baseRemoteViews(context, id)
                loading.setTextViewText(R.id.inv_reorder_empty_view, "Loading…")
                loading.setTextViewText(R.id.inv_reorder_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                try {
                    val products = InventoryRepository.fetchAllProducts()
                    val rows = InventoryRepository.reorderRows(products, WINDOW_DAYS, COVER_THRESHOLD, MAX_ROWS, true)
                    val total = InventoryRepository.reorderTotalFlagged(products, WINDOW_DAYS, COVER_THRESHOLD, true)
                    InventoryReorderCache.rows = rows
                    InventoryReorderCache.totalFlagged = total
                    InventoryReorderCache.loadFailed = false
                } catch (e: Exception) {
                    InventoryReorderCache.loadFailed = true
                }
                for (id in ids) {
                    val views = baseRemoteViews(context, id)
                    if (InventoryReorderCache.loadFailed) {
                        views.setTextViewText(R.id.inv_reorder_empty_view, "Couldn't load inventory data")
                        views.setTextViewText(R.id.inv_reorder_footer, "Couldn't load inventory data")
                    } else {
                        views.setTextViewText(R.id.inv_reorder_empty_view, "Nothing flagged right now 🎉")
                        val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                        views.setTextViewText(
                            R.id.inv_reorder_footer,
                            "${InventoryReorderCache.rows.size} of ${InventoryReorderCache.totalFlagged} flagged · Synced ${timeFmt.format(Date())}"
                        )
                    }
                    manager.updateAppWidget(id, views)
                    manager.notifyAppWidgetViewDataChanged(id, R.id.inv_reorder_listview)
                }
            }
        }

        private fun baseRemoteViews(context: Context, appWidgetId: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_reorder)
            val adapterIntent = Intent(context, InventoryReorderWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = android.net.Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.inv_reorder_listview, adapterIntent)
            views.setEmptyView(R.id.inv_reorder_listview, R.id.inv_reorder_empty_view)

            val refreshIntent = Intent(context, InventoryReorderWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_reorder_widget_root, pendingIntent)
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
