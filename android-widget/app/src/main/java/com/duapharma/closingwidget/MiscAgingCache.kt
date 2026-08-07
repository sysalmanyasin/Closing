package com.duapharma.closingwidget

/** Same pattern as InventoryReorderCache — the Provider's background fetch
    writes here, then calls notifyAppWidgetViewDataChanged(); the Service's
    RemoteViewsFactory.onDataSetChanged() just reads the snapshot back. */
object MiscAgingCache {
    @Volatile var rows: List<MiscAgingRepository.AgingRow> = emptyList()
    @Volatile var date: String = ""
    @Volatile var shift: String = ""
    @Volatile var loadFailed: Boolean = false
}
