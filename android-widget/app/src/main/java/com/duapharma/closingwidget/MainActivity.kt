package com.duapharma.closingwidget

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.refresh_button).setOnClickListener {
            ClosingWidgetProvider.updateAllWidgets(applicationContext)
            SalesWidgetProvider.updateAllWidgets(applicationContext)
            AggregatedWidgetProvider.updateAllWidgets(applicationContext)
            MonthSaleWidgetProvider.updateAllWidgets(applicationContext)
            TodaySaleWidgetProvider.updateAllWidgets(applicationContext)
            TotalCreditWidgetProvider.updateAllWidgets(applicationContext)
            SectionSummaryWidgetProvider.updateAllWidgets(applicationContext)
            StaffCreditWidgetProvider.updateAllWidgets(applicationContext)
            InventoryTotalWidgetProvider.updateAllWidgets(applicationContext)
            InventoryHealthWidgetProvider.updateAllWidgets(applicationContext)
            InventoryReorderWidgetProvider.updateAllWidgets(applicationContext)
            InventoryExcessTopWidgetProvider.updateAllWidgets(applicationContext)
            InventoryTopRunningWidgetProvider.updateAllWidgets(applicationContext)
            InventoryNegativeStockWidgetProvider.updateAllWidgets(applicationContext)
            InventoryDeadStockWidgetProvider.updateAllWidgets(applicationContext)
            InventoryNeverStockWidgetProvider.updateAllWidgets(applicationContext)
            LastShiftsWidgetProvider.updateAllWidgets(applicationContext)
            StrAwaitedWidgetProvider.updateAllWidgets(applicationContext)
            StrDispatchedWidgetProvider.updateAllWidgets(applicationContext)
            StrInboundWidgetProvider.updateAllWidgets(applicationContext)
            Toast.makeText(this, "Refreshing widgets…", Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.assistant_button).setOnClickListener {
            startActivity(Intent(this, AssistantActivity::class.java))
        }

        findViewById<Button>(R.id.search_inventory_button).setOnClickListener {
            startActivity(Intent(this, ProductSearchActivity::class.java))
        }

        findViewById<Button>(R.id.ai_briefing_button).setOnClickListener {
            val prompt = "Prepare a concise business briefing using only the live BT Sale Data records you can actually access. Cover today's sales and closing status, outstanding credit, and important exceptions. Include inventory low-stock, out-of-stock, or reorder alerts only if those records are available to you. If inventory or any other requested data is outside your connected data access, say so clearly and direct me to Search Inventory; do not estimate or invent figures. Include dates and figures where verified. This is read-only: do not create or modify records."
            startActivity(
                Intent(this, AssistantActivity::class.java)
                    .putExtra("ask_prompt", prompt)
                    .putExtra("focus_ask_dua", true)
            )
        }
    }
}
