package com.duapharma.closingwidget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Backs Widget 3's ListView. Same reasoning as
    InventoryReorderWidgetService.kt — a RemoteViewsService-backed
    ListView renders rows lazily via getViewAt(), so an arbitrary
    number of inbound STRs (warehouse, Warehouse 2, any other branch
    shipping into Bahria Town) never risks a TransactionTooLargeException
    the way manually stacking that many rows into one RemoteViews would. */
class StrInboundWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = StrInboundRemoteViewsFactory(applicationContext)
}

class StrInboundRemoteViewsFactory(private val context: android.content.Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<StrRepository.StrHeader> = emptyList()

    override fun onCreate() {}

    // Called by the system whenever notifyAppWidgetViewDataChanged() fires
    // (i.e. right after StrInboundWidgetProvider finishes a fetch) — just
    // snapshot whatever the provider already computed and cached.
    override fun onDataSetChanged() { rows = StrInboundCache.rows }

    override fun onDestroy() {}
    override fun getCount(): Int = rows.size
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val h = rows[position]
        val rowView = RemoteViews(context.packageName, R.layout.widget_str_inbound_row)
        rowView.setTextViewText(R.id.str_inbound_row_number, h.strNumber.ifBlank { "—" })
        rowView.setTextViewText(R.id.str_inbound_row_branch, h.dispatchBranch.ifBlank { "Unnamed branch" })
        rowView.setTextViewText(R.id.str_inbound_row_date, StrRepository.formatDate(h.dispatchedDate ?: h.strDate))
        rowView.setTextViewText(R.id.str_inbound_row_comment, h.comments.ifBlank { "No comment" })
        return rowView
    }
}
