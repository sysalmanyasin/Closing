package com.duapharma.closingwidget

/** Shared, in-process cache between InventoryDeadStockWidgetProvider
    (does the fetch + math) and InventoryDeadStockWidgetService's
    factory (renders whatever's in here, one row at a time, on demand).
    Same pattern as InventoryReorderCache — see that file's header. */
object InventoryDeadStockCache {
    @Volatile var rows: List<InventoryRepository.StockValueRow> = emptyList()
    @Volatile var loadFailed: Boolean = false
}
