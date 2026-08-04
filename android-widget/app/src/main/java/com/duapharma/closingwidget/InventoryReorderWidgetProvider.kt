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

/** Widget 3 — scrolling "Reorder Now — Most Urgent" list, fixed at the same
    30D window / <7D cover toggle state shown in BT Sale Data's Cover page. */
class InventoryReorderWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVREORDER_ACTION_REFRESH"
        private const val WINDOW_DAYS = 30
        private const val COVER_THRESHOLD = 7.0
        private const val MAX_ROWS = 60 // real data currently ~56; cap so an unbounded spike can't blow up the widget

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryReorderWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_inventory_reorder)
                loading.setTextViewText(R.id.inv_reorder_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                val result = try {
                    val products = InventoryRepository.fetchAllProducts()
                    val rows = InventoryRepository.reorderRows(products, WINDOW_DAYS, COVER_THRESHOLD, 500, true)
                    val total = InventoryRepository.reorderTotalFlagged(products, WINDOW_DAYS, COVER_THRESHOLD, true)
                    Pair(rows, total)
                } catch (e: Exception) { null }
                for (id in ids) manager.updateAppWidget(id, buildRemoteViews(context, result))
            }
        }

        private fun buildRemoteViews(context: Context, result: Pair<List<InventoryRepository.ReorderRow>, Int>?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_reorder)
            views.removeAllViews(R.id.inv_reorder_list_container)

            if (result == null) {
                views.setTextViewText(R.id.inv_reorder_footer, "Couldn't load inventory data")
            } else {
                val (rows, total) = result
                rows.take(MAX_ROWS).forEach { r ->
                    val rowView = RemoteViews(context.packageName, R.layout.widget_inventory_reorder_row)
                    rowView.setTextViewText(R.id.inv_reorder_row_name, r.name)
                    val cover = if (r.coverDays != null) String.format(Locale.US, "%.1fd cover", r.coverDays) else "0.0d cover"
                    rowView.setTextViewText(
                        R.id.inv_reorder_row_sub,
                        "$cover · reorder ${InventoryRepository.formatQty(r.demandQty)} units\nsold 30d: ${InventoryRepository.formatQty(r.saleQty)} units · ${InventoryRepository.formatMoney(r.saleValue)}"
                    )
                    rowView.setTextViewText(R.id.inv_reorder_row_value, InventoryRepository.formatMoney(r.demandValue))
                    views.addView(R.id.inv_reorder_list_container, rowView)
                }
                if (rows.size > MAX_ROWS) {
                    val moreView = RemoteViews(context.packageName, R.layout.widget_inventory_reorder_row)
                    moreView.setTextViewText(R.id.inv_reorder_row_name, "+ ${rows.size - MAX_ROWS} more — open BT Sale Data")
                    moreView.setTextViewText(R.id.inv_reorder_row_sub, "")
                    moreView.setTextViewText(R.id.inv_reorder_row_value, "")
                    views.addView(R.id.inv_reorder_list_container, moreView)
                }
                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.inv_reorder_footer, "${rows.size} of $total flagged · Synced ${timeFmt.format(Date())}")
            }

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
