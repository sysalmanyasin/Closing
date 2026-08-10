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

/** Misc/Ongoing Ledger "Latest Snapshot + Aging" — the same card added
    to the web app's Misc/Ongoing Ledger page (js/pages.js's
    mlBuildAgingCard()), as a home-screen widget. Rendered via a
    ListView + RemoteViewsService (MiscAgingWidgetService) since the
    row count is unbounded (every ongoing charge in the latest shift). */
class MiscAgingWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.MLAGING_ACTION_REFRESH"

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(android.content.ComponentName(context, MiscAgingWidgetProvider::class.java))
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return
            for (id in ids) {
                val loading = baseRemoteViews(context, id)
                loading.setTextViewText(R.id.ml_aging_empty_view, "Loading…")
                loading.setTextViewText(R.id.ml_aging_subtitle, "Loading…")
                manager.updateAppWidget(id, loading)
            }
            thread {
                try {
                    val result = MiscAgingRepository.fetchAging(context)
                    if (result != null) {
                        MiscAgingCache.rows = result.rows
                        MiscAgingCache.date = result.date
                        MiscAgingCache.shift = result.shift
                        MiscAgingCache.loadFailed = false
                    } else {
                        MiscAgingCache.loadFailed = true
                    }
                } catch (e: Exception) {
                    MiscAgingCache.loadFailed = true
                }
                for (id in ids) {
                    val views = baseRemoteViews(context, id)
                    if (MiscAgingCache.loadFailed) {
                        views.setTextViewText(R.id.ml_aging_empty_view, "Couldn't load misc/ongoing data")
                        views.setTextViewText(R.id.ml_aging_subtitle, "Couldn't load misc/ongoing data")
                    } else if (MiscAgingCache.rows.isEmpty()) {
                        views.setTextViewText(R.id.ml_aging_empty_view, "No ongoing charges right now 🎉")
                        views.setTextViewText(R.id.ml_aging_subtitle, "No misc/ongoing records yet")
                    } else {
                        val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                        views.setTextViewText(
                            R.id.ml_aging_subtitle,
                            "${MiscAgingCache.date} · ${MiscAgingCache.shift} · Synced ${timeFmt.format(Date())}"
                        )
                    }
                    manager.updateAppWidget(id, views)
                    manager.notifyAppWidgetViewDataChanged(id, R.id.ml_aging_listview)
                }
            }
        }

        private fun baseRemoteViews(context: Context, appWidgetId: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_misc_aging)
            val adapterIntent = Intent(context, MiscAgingWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
                data = android.net.Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
            }
            views.setRemoteAdapter(R.id.ml_aging_listview, adapterIntent)
            views.setEmptyView(R.id.ml_aging_listview, R.id.ml_aging_empty_view)

            val refreshIntent = Intent(context, MiscAgingWidgetProvider::class.java).apply { action = ACTION_REFRESH }
            val pendingIntent = PendingIntent.getBroadcast(context, 1, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.ml_aging_widget_root, pendingIntent)
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
