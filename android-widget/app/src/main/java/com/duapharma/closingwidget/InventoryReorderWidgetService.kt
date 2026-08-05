package com.duapharma.closingwidget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Backs Widget 3's ListView. Each row is fetched lazily via getViewAt() —
    this is the real fix for "can't load widget": a home-screen widget
    stacking dozens of manually-addView()'d rows into one RemoteViews blows
    past Android's binder transaction size limit and silently fails to
    update. A RemoteViewsService-backed ListView has no such limit since
    only the currently-visible rows are ever transacted. */
class InventoryReorderWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = InventoryReorderRemoteViewsFactory(applicationContext)
}

class InventoryReorderRemoteViewsFactory(private val context: android.content.Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<InventoryRepository.ReorderRow> = emptyList()

    override fun onCreate() {}

    // Called by the system whenever notifyAppWidgetViewDataChanged() fires
    // (i.e. right after InventoryReorderWidgetProvider finishes a fetch) —
    // just snapshot whatever the provider already computed and cached.
    override fun onDataSetChanged() { rows = InventoryReorderCache.rows }

    override fun onDestroy() {}
    override fun getCount(): Int = rows.size
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val r = rows[position]
        val rowView = RemoteViews(context.packageName, R.layout.widget_inventory_reorder_row)
        rowView.setTextViewText(R.id.inv_reorder_row_name, r.name)
        val cover = if (r.coverDays != null) String.format(java.util.Locale.US, "%.1fd cover", r.coverDays) else "0.0d cover"
        rowView.setTextViewText(
            R.id.inv_reorder_row_sub,
            "$cover · reorder ${InventoryRepository.formatQty(r.demandQty)} units\nsold 30d: ${InventoryRepository.formatQty(r.saleQty)} units · ${InventoryRepository.formatMoney(r.saleValue)}"
        )
        rowView.setTextViewText(R.id.inv_reorder_row_value, InventoryRepository.formatMoney(r.demandValue))
        return rowView
    }
}
