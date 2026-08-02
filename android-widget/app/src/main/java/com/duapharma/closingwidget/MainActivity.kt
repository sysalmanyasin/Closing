package com.duapharma.closingwidget

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
            Toast.makeText(this, "Refreshing widgets…", Toast.LENGTH_SHORT).show()
        }
    }
}
