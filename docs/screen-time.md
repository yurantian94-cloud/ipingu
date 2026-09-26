# Android 屏幕使用时间

这个功能使用 Android 官方 `UsageStatsManager`。它只会在用户主动授权后读取“各应用在前台停留了多久”，不会读取屏幕画面、短信、通知或输入内容。

## 原生壳接入

把 `native/android/ScreenTimePlugin.kt` 放到 Android 工程的 `app/src/main/java/com/aetheros/simulator/`，并在 `MainActivity` 的 `onCreate` 中注册：

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(ScreenTimePlugin::class.java)
    super.onCreate(savedInstanceState)
}
```

把 `native/android/AndroidManifest.additions.xml` 中的 `uses-permission` 合并到 `android/app/src/main/AndroidManifest.xml`。

如果包名不是 `com.aetheros.simulator`，把 Kotlin 文件第一行的 package 改成 Android 工程实际的 package。

首次使用时，设置页会打开系统的“使用情况访问权限”页面。开启 SullyOS 后，角色就能在聊天中调用 `read_screen_time`。
