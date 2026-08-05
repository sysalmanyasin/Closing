package com.duapharma.closingwidget

import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Backs the Negative Stock widget's ListView — same reasoning as
    InventoryReorderWidgetService: an unpredictable, potentially large
    row count is safest rendered lazily via RemoteViewsService rather
    than manually addView()'d into one RemoteViews. */
class InventoryNegativeStockWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = InventoryNegativeStockRemoteViewsFactory(applicationContext)
}

class InventoryNegativeStockRemoteViewsFactory(private val context: android.content.Context) : RemoteViewsService.RemoteViewsFactory {
    private var rows: List<InventoryRepository.StockValueRow> = emptyList()

    override fun onCreate() {}
    override fun onDataSetChanged() { rows = InventoryNegativeStockCache.rows }
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
