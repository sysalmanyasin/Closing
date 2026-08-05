package com.duapharma.closingwidget

/** Shared, in-process cache between InventoryReorderWidgetProvider (which
    does the actual network fetch + BT Sale Data math) and
    InventoryReorderRemoteViewsService's factory (which just renders
    whatever's in here, one row at a time, on demand). AppWidget
    RemoteViewsServices run in the same process as the rest of the app
    unless a service `android:process` override says otherwise — this one
    doesn't — so a plain object with @Volatile fields is safe here. */
object InventoryReorderCache {
    @Volatile var rows: List<InventoryRepository.ReorderRow> = emptyList()
    @Volatile var totalFlagged: Int = 0
    @Volatile var loadFailed: Boolean = false
}
