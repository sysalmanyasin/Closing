package com.duapharma.closingwidget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Backs the Never Sold (Top 20) widget's ListView — see
    InventoryReorderWidgetService's header for why a ListView-backed
    RemoteViewsService is used instead of manually stacked rows. */
class InventoryNeverStockWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = InventoryNeverStockRemoteViewsFactory(applicationContext)
}

class InventoryNeverStockRemoteViewsFactory(private val context: android.content.Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<InventoryRepository.StockValueRow> = emptyList()

    override fun onCreate() {}
    override fun onDataSetChanged() { rows = InventoryNeverStockCache.rows }
    override fun onDestroy() {}
    override fun getCount(): Int = rows.size
    override fun getViewTypeCount(): Int = 1
    override fun getItemId(position: Int): Long = position.toLong()
    override fun hasStableIds(): Boolean = true
    override fun getLoadingView(): RemoteViews? = null

    override fun getViewAt(position: Int): RemoteViews {
        val r = rows[position]
        val rowView = RemoteViews(context.packageName, R.layout.widget_inventory_stockvalue_row)
        rowView.setTextViewText(R.id.inv_sv_row_name, r.name)
        rowView.setTextViewText(R.id.inv_sv_row_sub, listOf(r.company, r.extra).filter { it.isNotEmpty() }.joinToString(" · "))
        rowView.setTextViewText(R.id.inv_sv_row_value, InventoryRepository.formatMoney(r.value))
        return rowView
    }
}
