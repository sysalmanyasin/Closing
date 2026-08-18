package com.duapharma.closingwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

/** Widget — "Awaited STR (Dispatch from Bahria Town)": every STR where
    Bahria Town is the dispatch branch (direction == "out") that hasn't
    been dispatched, received, or closed yet — i.e. still sitting in
    the Awaited stage. Rendered as up to MAX_ROWS manually stacked
    cards (bounded count, same reasoning as LastShiftsWidgetProvider —
    a rolling 7-day STR window is never large enough to need a
    RemoteViewsService here). */
class StrAwaitedWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.STRAWAITED_ACTION_REFRESH"
        private const val MAX_ROWS = 6

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, StrAwaitedWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_str_awaited)
                loading.setTextViewText(R.id.str_awaited_footer, context.getString(R.string.str_awaited_widget_loading))
                manager.updateAppWidget(id, loading)
            }

            thread {
                val headers = try {
                    StrRepository.fetchHeaders()
                } catch (e: Exception) {
                    null
                }
                for (id in ids) {
                    val views = buildRemoteViews(context, headers)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, headers: List<StrRepository.StrHeader>?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_str_awaited)
            views.removeAllViews(R.id.str_awaited_list_container)

            if (headers == null) {
                views.setTextViewText(R.id.str_awaited_footer, "Couldn't load STR data")
            } else {
                val matches = headers
                    .filter { StrRepository.isDispatchedFromBT(it) && StrRepository.stage(it) == "awaited" && !StrRepository.isClosed(it) }
                    .sortedBy { it.strDate ?: "" } // oldest first — most overdue on top

                if (matches.isEmpty()) {
                    views.setTextViewText(R.id.str_awaited_footer, "Nothing awaited right now 🎉")
                } else {
                    matches.take(MAX_ROWS).forEach { h ->
                        val row = RemoteViews(context.packageName, R.layout.widget_str_awaited_row)
                        row.setTextViewText(R.id.str_row_number, h.strNumber.ifBlank { "—" })
                        row.setTextViewText(R.id.str_row_date, StrRepository.formatDate(h.strDate))
                        row.setTextViewText(R.id.str_row_comment, h.comments.ifBlank { "No comment" })
                        views.addView(R.id.str_awaited_list_container, row)
                    }
                    val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                    val extra = if (matches.size > MAX_ROWS) " (+${matches.size - MAX_ROWS} more)" else ""
                    views.setTextViewText(
                        R.id.str_awaited_footer,
                        "${matches.size} awaited$extra · Synced ${timeFmt.format(Date())}"
                    )
                }
            }

            val refreshIntent = Intent(context, StrAwaitedWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.str_awaited_widget_root, pendingIntent)

            return views
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        refreshWidgets(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            updateAllWidgets(context)
        }
    }
}
