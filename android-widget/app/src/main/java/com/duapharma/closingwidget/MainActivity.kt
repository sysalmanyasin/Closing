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
            TotalCreditWidgetProvider.updateAllWidgets(applicationContext)
            SectionSummaryWidgetProvider.updateAllWidgets(applicationContext)
            StaffCreditWidgetProvider.updateAllWidgets(applicationContext)
            InventoryTotalWidgetProvider.updateAllWidgets(applicationContext)
            InventoryHealthWidgetProvider.updateAllWidgets(applicationContext)
            InventoryReorderWidgetProvider.updateAllWidgets(applicationContext)
            InventoryExcessTopWidgetProvider.updateAllWidgets(applicationContext)
            InventoryTopRunningWidgetProvider.updateAllWidgets(applicationContext)
            Toast.makeText(this, "Refreshing widgets…", Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.search_inventory_button).setOnClickListener {
            startActivity(Intent(this, ProductSearchActivity::class.java))
        }
    }
}
