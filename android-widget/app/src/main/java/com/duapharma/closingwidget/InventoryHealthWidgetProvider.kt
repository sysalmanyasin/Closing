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

/** Widget 2 — Never Sold (60D), Dead Stock (60D), Excess Stock Total, Corrected Excess Stock. */
class InventoryHealthWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.INVHEALTH_ACTION_REFRESH"

        data class Data(val hero: InventoryRepository.HeroStats, val excess: InventoryRepository.ExcessSummary)

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventoryHealthWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_inventory_health)
                loading.setTextViewText(R.id.inv_health_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                val data = try {
                    val products = InventoryRepository.fetchAllProducts()
                    val rows = InventoryRepository.computeRows(products)
                    val asOf = SimpleDateFormat("dd MMM yyyy", Locale.getDefault()).format(Date())
                    val hero = InventoryRepository.heroStats(rows, asOf)
                    val retain = InventoryRepository.fetchExcessRetainSet()
                    val excess = InventoryRepository.excessSummary(rows, retain)
                    Data(hero, excess)
                } catch (e: Exception) { null }
                for (id in ids) manager.updateAppWidget(id, buildRemoteViews(context, data))
            }
        }

        private fun buildRemoteViews(context: Context, data: Data?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_health)
            if (data == null || !data.hero.dataReady) {
                views.setTextViewText(R.id.inv_never_sold_value, "—")
                views.setTextViewText(R.id.inv_dead_stock_value, "—")
                views.setTextViewText(R.id.inv_excess_raw_value, "—")
                views.setTextViewText(R.id.inv_excess_corrected_value, "—")
                views.setTextViewText(R.id.inv_health_footer, "Couldn't load inventory data")
            } else {
                views.setTextViewText(R.id.inv_never_sold_value, InventoryRepository.formatMoney(data.hero.neverSold60Value))
                views.setTextViewText(R.id.inv_dead_stock_value, InventoryRepository.formatMoney(data.hero.deadStock60Value))
                views.setTextViewText(R.id.inv_excess_raw_value, InventoryRepository.formatMoney(data.excess.rawExcessValue))
                views.setTextViewText(R.id.inv_excess_corrected_value, InventoryRepository.formatMoney(data.excess.correctedExcessValue))
                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.inv_health_footer, "as of ${data.hero.asOf} · Synced ${timeFmt.format(Date())}")
            }
            val refreshIntent = Intent(context, InventoryHealthWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_health_widget_root, pendingIntent)
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
