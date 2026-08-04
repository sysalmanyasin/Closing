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

/** Widget 1 — Total Inventory Level & Negative Value. */
class InventoryTotalWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVTOTAL_ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryTotalWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_inventory_total)
                loading.setTextViewText(R.id.inv_total_asof, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                val stats = try {
                    val products = InventoryRepository.fetchAllProducts()
                    val rows = InventoryRepository.computeRows(products)
                    val asOf = SimpleDateFormat("dd MMM yyyy", Locale.getDefault()).format(Date())
                    InventoryRepository.heroStats(rows, asOf)
                } catch (e: Exception) { null }
                for (id in ids) manager.updateAppWidget(id, buildRemoteViews(context, stats))
            }
        }

        private fun buildRemoteViews(context: Context, stats: InventoryRepository.HeroStats?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_total)
            if (stats == null || !stats.dataReady) {
                views.setTextViewText(R.id.inv_total_value, "—")
                views.setTextViewText(R.id.inv_negative_value, "—")
                views.setTextViewText(R.id.inv_total_asof, "Couldn't load inventory data")
            } else {
                views.setTextViewText(R.id.inv_total_value, InventoryRepository.formatMoney(stats.totalInventoryValue))
                views.setTextViewText(R.id.inv_negative_value, InventoryRepository.formatMoney(stats.negativeValue))
                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.inv_total_asof, "as of ${stats.asOf} · Synced ${timeFmt.format(Date())}")
            }
            val refreshIntent = Intent(context, InventoryTotalWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_total_widget_root, pendingIntent)
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
