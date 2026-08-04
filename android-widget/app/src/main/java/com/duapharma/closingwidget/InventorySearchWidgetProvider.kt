package com.duapharma.closingwidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Widget 6 — Product Search launcher. RemoteViews can't host a live
    search box + dropdown + results panel, so this widget is a tap
    shortcut into ProductSearchActivity, which has the real interactive
    search UI (type a name or code, pick a match, see full details). */
class InventorySearchWidgetProvider : AppWidgetProvider() {

    companion object {
        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, InventorySearchWidgetProvider::class.java))
            for (id in ids) manager.updateAppWidget(id, buildRemoteViews(context))
        }

        private fun buildRemoteViews(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_inventory_search)
            val openIntent = Intent(context, ProductSearchActivity::class.java)
            val pendingIntent = PendingIntent.getActivity(context, 1, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.inv_search_widget_root, pendingIntent)
            return views
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) appWidgetManager.updateAppWidget(id, buildRemoteViews(context))
    }
}
