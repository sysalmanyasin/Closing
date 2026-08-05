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

/** "Last 3 Shift Closings" — the 3 most recently saved (non-draft)
    sheets, newest first, each showing its OWN shift-only reconciliation
    (see LastShiftsRepository). Distinct from AggregatedWidgetProvider's
    period-since-last-Final strip: every number here is scoped to that
    one shift, never rolled up. Rendered as up to 3 manually stacked
    cards (bounded count, unlike the inventory ListView widgets, so no
    RemoteViewsService is needed here). */
class LastShiftsWidgetProvider : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.duapharma.closingwidget.LASTSHIFTS_ACTION_REFRESH"
        private const val COUNT = 3

        fun updateAllWidgets(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(
                android.content.ComponentName(context, LastShiftsWidgetProvider::class.java)
            )
            refreshWidgets(context, manager, ids)
        }

        private fun refreshWidgets(context: Context, manager: AppWidgetManager, ids: IntArray) {
            if (ids.isEmpty()) return

            for (id in ids) {
                val loading = RemoteViews(context.packageName, R.layout.widget_last_shifts)
                loading.setTextViewText(R.id.last_shifts_footer, context.getString(R.string.last_shifts_widget_loading))
                manager.updateAppWidget(id, loading)
            }

            thread {
                val snapshots = try {
                    LastShiftsRepository.fetchLastShiftClosings(COUNT)
                } catch (e: Exception) {
                    null
                }
                for (id in ids) {
                    val views = buildRemoteViews(context, snapshots)
                    manager.updateAppWidget(id, views)
                }
            }
        }

        private fun buildRemoteViews(context: Context, snapshots: List<ShiftClosingSnapshot>?): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_last_shifts)
            views.removeAllViews(R.id.last_shifts_list_container)

            if (snapshots == null) {
                views.setTextViewText(R.id.last_shifts_footer, "Couldn't load closing data")
            } else if (snapshots.isEmpty()) {
                views.setTextViewText(R.id.last_shifts_footer, "No saved shifts yet")
            } else {
                snapshots.forEach { s ->
                    val row = RemoteViews(context.packageName, R.layout.widget_last_shifts_row)
                    row.setTextViewText(R.id.ls_row_header, "${s.date} — ${s.shift}")
                    row.setTextViewText(R.id.ls_row_cash, LastShiftsRepository.formatAmount(s.netCashAvailable))
                    row.setTextViewText(R.id.ls_row_prev, LastShiftsRepository.formatAmount(s.prevShiftCash))
                    row.setTextViewText(R.id.ls_row_net_committed, LastShiftsRepository.formatAmount(s.netCommittedCash))
                    row.setTextViewText(R.id.ls_row_target, LastShiftsRepository.formatAmount(s.targetNetSale))
                    row.setTextViewText(R.id.ls_row_diff_label, s.diffLabel)
                    row.setTextViewText(R.id.ls_row_diff, LastShiftsRepository.formatAmount(s.diff))
                    val color = if (s.diff >= 0) 0xFF2E7D32.toInt() else 0xFFB3261E.toInt()
                    row.setTextColor(R.id.ls_row_diff, color)
                    views.addView(R.id.last_shifts_list_container, row)
                }
                val timeFmt = SimpleDateFormat("h:mm a", Locale.getDefault())
                views.setTextViewText(R.id.last_shifts_footer, "This shift only · Synced ${timeFmt.format(Date())}")
            }

            val refreshIntent = Intent(context, LastShiftsWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            val pendingIntent = PendingIntent.getBroadcast(
                context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.last_shifts_widget_root, pendingIntent)

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
