package com.aetheros.simulator

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "ScreenTime")
class ScreenTimePlugin : Plugin() {
    private fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    @com.getcapacitor.PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(JSObject().put("native", true).put("hasUsageAccess", hasUsageAccess()))
    }

    @com.getcapacitor.PluginMethod
    fun openUsageAccessSettings(call: PluginCall) {
        context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        call.resolve()
    }

    @com.getcapacitor.PluginMethod
    fun query(call: PluginCall) {
        if (!hasUsageAccess()) { call.reject("未授予使用情况访问权限"); return }
        val startMs = call.getLong("startMs", 0L)
        val endMs = call.getLong("endMs", System.currentTimeMillis())
        val limit = call.getInt("limit", 30).coerceIn(1, 100)
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val stats = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startMs, endMs)
            .filter { it.totalTimeInForeground > 0L }
            .sortedByDescending { it.totalTimeInForeground }
            .take(limit)
        val packageManager = context.packageManager
        val apps = JSONArray()
        var total = 0L
        for (stat in stats) {
            total += stat.totalTimeInForeground
            val label = try {
                packageManager.getApplicationLabel(packageManager.getApplicationInfo(stat.packageName, 0)).toString()
            } catch (_: Exception) { stat.packageName }
            apps.put(JSONObject().put("packageName", stat.packageName).put("appName", label)
                .put("foregroundMs", stat.totalTimeInForeground).put("lastUsedMs", stat.lastTimeUsed))
        }
        call.resolve(JSObject().put("startMs", startMs).put("endMs", endMs)
            .put("totalForegroundMs", total).put("apps", apps))
    }
}
