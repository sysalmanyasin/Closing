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

/** Widget 3 — "Dispatched STR — Inbound to Bahria Town" scrolling
    list: every STR dispatched FROM another branch (Warehouse,
    Warehouse 2, or any other source — direction == "in", meaning
    Bahria Town is the receive branch) that has been dispatched but is
    not yet closed or received at Bahria Town. Rendered via a ListView
    + RemoteViewsService (StrInboundWidgetService), same pattern as
    InventoryReorderWidgetProvider — the number of branches shipping in
    at once isn't bounded the way a single branch's outgoing STRs are,
    so this one gets the scrolling treatment rather than
    StrAwaited/StrDispatched's stacked-card layout. */
class StrInboundWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.STRINBOUND_ACTION_REFRESH"
        private const val MAX_ROWS = 300 // generous cap — a rolling 7-day STR window is small

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, StrInboundWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = baseRemoteViews(context, id)
                loading.setTextViewText(R.id.str_inbound_empty_view, "Loading…")
                loading.setTextViewText(R.id.str_inbound_footer, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                try {
                    val headers = StrRepository.fetchHeaders()
                    if (headers == null) {
                        StrInboundCache.loadFailed = true
                    } else {
                        val matches = headers
                            .filter { StrRepository.isReceivedAtBT(it) && StrRepository.stage(it) == "dispatched" && !StrRepository.isClosed(it) }
                            .sortedBy { it.dispatchedDate ?: it.strDate ?: "" } // oldest first — most overdue on top
                            .take(MAX_ROWS)
                        StrInboundCache.rows = matches
                        StrInboundCache.loadFailed = false
                    }
                } catch (e: Exception) {
                    StrInboundCache.loadFailed = true
                }
                for (id in ids) {
                    val views = baseRemoteViews(context, id)
                    if (StrInboundCache.loadFailed) {
                        views.setTextViewText(R.id.str_inbound_empty_view, "Couldn't load STR data")
                        views.setTextViewText(R.id.str_inbound_footer, "Couldn't load STR data")
                    } else {
                        views.setTextViewText(R.id.str_inbound_empty_view, "Nothing inbound right now 🎉")
                        val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                        views.setTextViewText(
                            R.id.str_inbound_footer,
                            "${StrInboundCache.rows.size} in transit · Synced ${timeFmt.format(Date())}"
                        )
                    }
                    manager.updateAppWidget(id, views)
                    manager.notifyAppWidgetViewDataChanged(id, R.id.str_inbound_listview)
                }
            }
        }

        private fun baseRemoteViews(context: Context, appWidgetId: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_str_inbound)
            val adapterIntent = Intent(context, StrInboundWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = android.net.Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.str_inbound_listview, adapterIntent)
            views.setEmptyView(R.id.str_inbound_listview, R.id.str_inbound_empty_view)

            val refreshIntent = Intent(context, StrInboundWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.str_inbound_widget_root, pendingIntent)
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
