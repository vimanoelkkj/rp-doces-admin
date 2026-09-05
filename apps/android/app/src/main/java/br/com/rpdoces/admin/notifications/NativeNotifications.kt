package br.com.rpdoces.admin.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import br.com.rpdoces.admin.MainActivity
import br.com.rpdoces.admin.R
import br.com.rpdoces.admin.data.orders.Order
import java.text.NumberFormat
import java.util.Locale

object NativeNotifications {
    private const val PREFS = "rp_admin_preferences"
    private const val ENABLED_KEY = "notifications_enabled"
    private const val CHANNEL_ID = "paid_orders"
    private const val CHANNEL_NAME = "Pedidos pagos"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Avisos quando um pedido da R&P Doces é pago."
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    fun hasPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun isEnabled(context: Context): Boolean {
        val preferred = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(ENABLED_KEY, false)
        return preferred && hasPermission(context) && NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(ENABLED_KEY, enabled)
            .apply()
        if (enabled) createChannel(context)
    }

    fun showPaidOrder(context: Context, order: Order) {
        if (!isEnabled(context)) return
        createChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            order.id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val customer = order.customerName?.takeIf { it.isNotBlank() } ?: "Cliente"
        val total = NumberFormat.getCurrencyInstance(Locale("pt", "BR")).format(order.totalCents / 100.0)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Pedido #${order.id} pago")
            .setContentText("$customer · $total")
            .setStyle(NotificationCompat.BigTextStyle().bigText("$customer confirmou o pagamento do pedido #${order.id}. Total: $total."))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        NotificationManagerCompat.from(context).notify(20_000 + order.id, notification)
    }
}
