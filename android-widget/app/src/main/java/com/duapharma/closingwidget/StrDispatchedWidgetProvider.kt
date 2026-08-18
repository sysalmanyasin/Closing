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

/** Widget — "Dispatched STR (Dispatch from Bahria Town)": every STR
    where Bahria Town is the dispatch branch (direction == "out") that
    HAS been dispatched but is not yet closed or received — i.e.
    currently in transit out of Bahria Town. Same bounded-stacked-card
    pattern as StrAwaitedWidgetProvider — see that file's doc-comment. */
class StrDispatchedWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.STRDISPATCHED_ACTION_REFRESH"
        private const val MAX_ROWS = 6

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, StrDispatchedWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_str_dispatched)
                loading.setTextViewText(R.id.str_dispatched_footer, context.getString(R.string.str_dispatched_widget_loading))
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
            val views = RemoteViews(context.packageName, R.layout.widget_str_dispatched)
            views.removeAllViews(R.id.str_dispatched_list_container)

            if (headers == null) {
                views.setTextViewText(R.id.str_dispatched_footer, "Couldn't load STR data")
            } else {
                val matches = headers
                    .filter { StrRepository.isDispatchedFromBT(it) && StrRepository.stage(it) == "dispatched" && !StrRepository.isClosed(it) }
                    .sortedBy { it.dispatchedDate ?: it.strDate ?: "" } // oldest dispatch first — most overdue on top

                if (matches.isEmpty()) {
                    views.setTextViewText(R.id.str_dispatched_footer, "Nothing in transit right now 🎉")
                } else {
                    matches.take(MAX_ROWS).forEach { h ->
                        val row = RemoteViews(context.packageName, R.layout.widget_str_dispatched_row)
                        row.setTextViewText(R.id.str_row_number, h.strNumber.ifBlank { "—" })
                        row.setTextViewText(R.id.str_row_date, StrRepository.formatDate(h.dispatchedDate ?: h.strDate))
                        row.setTextViewText(R.id.str_row_comment, h.comments.ifBlank { "No comment" })
                        views.addView(R.id.str_dispatched_list_container, row)
                    }
                    val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                    val extra = if (matches.size > MAX_ROWS) " (+${matches.size - MAX_ROWS} more)" else ""
                    views.setTextViewText(
                        R.id.str_dispatched_footer,
                        "${matches.size} in transit$extra · Synced ${timeFmt.format(Date())}"
                    )
                }
            }

            val refreshIntent = Intent(context, StrDispatchedWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.str_dispatched_widget_root, pendingIntent)

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
