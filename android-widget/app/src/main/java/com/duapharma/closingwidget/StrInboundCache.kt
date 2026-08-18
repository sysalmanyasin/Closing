package com.duapharma.closingwidget

/** Shared, in-process cache between StrInboundWidgetProvider (which does
    the actual network fetch) and StrInboundRemoteViewsFactory (which
    just renders whatever's in here, one row at a time, on demand).
    Same pattern as InventoryReorderCache.kt — see that file's
    doc-comment for why a plain @Volatile object is safe here. */
object StrInboundCache {
    @Volatile var rows: List<StrRepository.StrHeader> = emptyList()
    @Volatile var loadFailed: Boolean = false
}
