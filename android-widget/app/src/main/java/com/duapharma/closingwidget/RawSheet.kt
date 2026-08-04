package com.duapharma.closingwidget

import org.json.JSONObject

/**
 * Shared internal parsing DTO for a single saved closing sheet, as returned
 * by the backend's sheet-list endpoint. Used by both ClosingRepository and
 * AggregatedRepository to walk recent sheets before computing their
 * respective summaries.
 */
internal data class RawSheet(
    val date: String,
    val shift: String,
    val data: JSONObject
)
