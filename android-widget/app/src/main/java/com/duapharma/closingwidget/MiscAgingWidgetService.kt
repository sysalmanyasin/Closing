package com.duapharma.closingwidget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Backs the Misc/Ongoing Aging widget's ListView. Each row is fetched
    lazily via getViewAt() — same reason as InventoryReorderWidgetService:
    a shop can easily have 20-40+ ongoing misc charges, and manually
    addView()-ing that many rows into one RemoteViews risks
    TransactionTooLargeException. A RemoteViewsService-backed ListView
    has no such limit since only the currently-visible rows are ever
    transacted, and it scrolls natively. */
class MiscAgingWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = MiscAgingRemoteViewsFactory(applicationContext)
}

class MiscAgingRemoteViewsFactory(private val context: android.content.Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<MiscAgingRepository.AgingRow> = emptyList()

    override fun onCreate() {}

    // Called by the system right after MiscAgingWidgetProvider's background
    // fetch finishes and calls notifyAppWidgetViewDataChanged() — just
    // snapshot whatever the provider already computed and cached.
    override fun onDataSetChanged() { rows = MiscAgingCache.rows }

    override fun onDestroy() {}
    override fun getCount(): Int = rows.size
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val r = rows[position]
        val rowView = RemoteViews(context.packageName, R.layout.widget_misc_aging_row)
        rowView.setTextViewText(R.id.ml_aging_row_label, r.label)
        rowView.setTextViewText(R.id.ml_aging_row_since, "since ${r.since}")
        rowView.setTextViewText(R.id.ml_aging_row_value, MiscAgingRepository.formatAmount(r.value))

        val ageText = if (r.ageDays == 0) "new today" else "${r.ageDays}d old"
        rowView.setTextViewText(R.id.ml_aging_row_badge, ageText)

        // 3-tier colour cue, matching the web card's green/amber/red bands
        // (new <7d / mid 7-14d / old 14d+) using the module's existing
        // status chip drawables/colours rather than inventing new ones.
        val (chipBg, chipText) = when {
            r.ageDays >= 14 -> R.drawable.chip_negative to R.color.status_negative
            r.ageDays >= 7  -> R.drawable.chip_warning to R.color.status_warning
            else            -> R.drawable.chip_positive to R.color.status_positive
        }
        rowView.setInt(R.id.ml_aging_row_badge, "setBackgroundResource", chipBg)
        rowView.setTextColor(R.id.ml_aging_row_badge, context.getColor(chipText))

        return rowView
    }
}
