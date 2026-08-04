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

/** Widget 4 — Top 10 Excess Stock Items, highest value first. */
class InventoryExcessTopWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVEXCESSTOP_ACTION_REFRESH"
        private const val TOP_N = 10

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryExcessTopWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_inventory_excess_top)
                loading.setTextViewText(R.id.inv_excess_top_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                val rows = try {
                    val products = InventoryRepository.fetchAllProducts()
                    val computed = InventoryRepository.computeRows(products)
                    val retain = InventoryRepository.fetchExcessRetainSet()
                    InventoryRepository.excessSummary(computed, retain, TOP_N).topRows
                } catch (e: Exception) { null }
                for (id in ids) manager.updateAppWidget(id, buildRemoteViews(context, rows))
            }
        }

        private fun buildRemoteViews(context: Context, rows: List<InventoryRepository.ExcessRow>?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_excess_top)
            views.removeAllViews(R.id.inv_excess_top_list_container)

            if (rows == null) {
                views.setTextViewText(R.id.inv_excess_top_footer, "Couldn't load inventory data")
            } else {
                rows.forEach { r ->
                    val rowView = RemoteViews(context.packageName, R.layout.widget_inventory_excess_top_row)
                    rowView.setTextViewText(R.id.inv_excess_row_name, r.name)
                    val age = if (r.daysOld != null) "${r.daysOld.toInt()}d old" else ""
                    rowView.setTextViewText(R.id.inv_excess_row_sub, listOf(r.company, age).filter { it.isNotEmpty() }.joinToString(" · "))
                    rowView.setTextViewText(R.id.inv_excess_row_value, InventoryRepository.formatMoney(r.value))
                    views.addView(R.id.inv_excess_top_list_container, rowView)
                }
                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.inv_excess_top_footer, "Synced ${timeFmt.format(Date())}")
            }

            val refreshIntent = Intent(context, InventoryExcessTopWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_excess_top_widget_root, pendingIntent)
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
