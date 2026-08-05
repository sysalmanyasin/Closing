package com.duapharma.closingwidget

/** Shared, in-process cache between InventoryNegativeStockWidgetProvider
    (does the fetch + math) and InventoryNegativeStockWidgetService's
    factory (renders whatever's in here, one row at a time, on demand).
    Same pattern as InventoryReorderCache — see that file's header. */
object InventoryNegativeStockCache {
    @Volatile var rows: List<InventoryRepository.StockValueRow> = emptyList()
    @Volatile var loadFailed: Boolean = false
}
