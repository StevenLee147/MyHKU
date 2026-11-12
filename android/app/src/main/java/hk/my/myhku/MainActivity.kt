package hk.my.myhku

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android host for the MyHKU React dashboard and official HKU WebView.
 * SSO/MFA happens inside the official pages. Passwords and cookies are never
 * read into normalized snapshots.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var dashboard: WebView
    private lateinit var officialPanel: LinearLayout
    private lateinit var status: TextView
    private lateinit var assetLoader: WebViewAssetLoader
    private var snapshotPrefs: android.content.SharedPreferences? = null
    private var latestPayload = "{\"version\":4,\"connected\":false}"
    private val sitePayloads = mutableMapOf<String, String>()
    private val connectorSource: String by lazy {
        val raw = runCatching {
            assets.open("dashboard-app/hku-connector.js").bufferedReader().use { it.readText() }
        }.getOrDefault("")
        if (raw.isBlank()) ""
        else "(async () => { globalThis.__MYHKU_SKIP_POST__ = true; try { await $raw; } catch (_) {} })()"
    }

    private val allowedHosts = setOf(
        "moodle.hku.hk", "studentportal.hku.hk", "hkuportal.hku.hk",
        "sis-main.hku.hk", "sweb.hku.hk", "intraweb.hku.hk", "adfs.connect.hku.hk",
        "login.microsoftonline.com", "login.microsoft.com", "login.windows.net",
        "login.live.com", "account.live.com", "account.microsoft.com"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!hasLegalConsent()) {
            showLegalAgreement { initializeApp(savedInstanceState) }
            return
        }
        initializeApp(savedInstanceState)
    }

    private fun legalDocuments() = JSONObject(assets.open("dashboard-app/legal/agreements.json").bufferedReader().use { it.readText() })
    private fun hasLegalConsent() = getSharedPreferences("myhku_legal", MODE_PRIVATE).getString("version", null) == legalDocuments().getString("version")

    private fun showLegalAgreement(onAccepted: () -> Unit) {
        val legal = legalDocuments()
        val documents = legal.getJSONArray("documents")
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(36, 28, 36, 28) }
        content.addView(TextView(this).apply { text = "MyHKU · 使用须知"; textSize = 24f })
        content.addView(TextView(this).apply { text = "独立开发的学习工具，非 HKU 官方应用。请阅读并逐项确认。协议版本：${legal.getString("version")}"; textSize = 15f })
        val checks = mutableListOf<CheckBox>()
        val accept = Button(this).apply { text = "同意并继续"; isEnabled = false }
        for (index in 0 until documents.length()) {
            val document = documents.getJSONObject(index)
            content.addView(TextView(this).apply { text = "\n${document.getString("title")}"; textSize = 20f })
            val paragraphs = document.getJSONArray("paragraphs")
            content.addView(TextView(this).apply { text = (0 until paragraphs.length()).joinToString("\n\n") { paragraphs.getString(it) }; textSize = 15f })
            val check = CheckBox(this).apply {
                text = "我已阅读并同意《${document.getString("title")}》"
                setOnCheckedChangeListener { _, _ -> accept.isEnabled = checks.size == documents.length() && checks.all { it.isChecked } }
            }
            checks.add(check); content.addView(check)
        }
        content.addView(accept)
        content.addView(Button(this).apply { text = "不同意并退出"; setOnClickListener { finish() } })
        accept.setOnClickListener {
            if (!checks.all { it.isChecked }) return@setOnClickListener
            val saved = getSharedPreferences("myhku_legal", MODE_PRIVATE).edit()
                .putString("version", legal.getString("version"))
                .putLong("acceptedAt", System.currentTimeMillis())
                .commit()
            if (saved) onAccepted() else Toast.makeText(this, "无法保存协议确认，请重试", Toast.LENGTH_LONG).show()
        }
        setContentView(ScrollView(this).apply { addView(content) })
    }

    private fun isAllowedHost(host: String?): Boolean {
        val clean = host?.lowercase() ?: return false
        return allowedHosts.any { clean == it || clean.endsWith(".$it") }
    }

    private fun isHkuDownloadUrl(rawUrl: String): Boolean {
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false
        return uri.scheme == "https" && (host == "hku.hk" || host.endsWith(".hku.hk"))
    }

    private fun enqueueAuthenticatedDownload(url: String, userAgent: String? = null, contentDisposition: String? = null, mimeType: String? = null): Boolean {
        if (!isHkuDownloadUrl(url)) return false
        return runCatching {
            val uri = Uri.parse(url)
            val filename = URLUtil.guessFileName(url, contentDisposition, mimeType).ifBlank { "myhku-download" }
            val request = DownloadManager.Request(uri).apply {
                val cookie = CookieManager.getInstance().getCookie(url)
                if (!cookie.isNullOrBlank()) addRequestHeader("Cookie", cookie)
                if (!userAgent.isNullOrBlank()) addRequestHeader("User-Agent", userAgent)
                setTitle(filename)
                setDescription("MyHKU 课程资料下载")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                try {
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
                } catch (_: SecurityException) {
                    setDestinationInExternalFilesDir(this@MainActivity, Environment.DIRECTORY_DOWNLOADS, filename)
                }
            }
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.enqueue(request)
            runOnUiThread {
                Toast.makeText(this, "已加入系统下载：$filename", Toast.LENGTH_SHORT).show()
            }
            true
        }.getOrDefault(false)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun initializeApp(savedInstanceState: Bundle?) {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        snapshotPrefs = runCatching {
            val key = MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            EncryptedSharedPreferences.create(
                this,
                "myhku_snapshot",
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }.getOrNull()

        for (site in listOf("moodle", "portal", "sis")) {
            snapshotPrefs?.getString(site, null)?.let { sitePayloads[site] = it }
        }
        latestPayload = combinePayloads()

        val container = FrameLayout(this)

        val sharedDashboardBridge = DashboardBridge()
        dashboard = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            addJavascriptInterface(sharedDashboardBridge, "myhkuAndroid")
            addJavascriptInterface(sharedDashboardBridge, "MyHKUDashboard")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.host == "appassets.androidplatform.net") return false
                    if (uri.scheme == "https" && isAllowedHost(uri.host)) {
                        showOfficial(uri.toString())
                        return true
                    }
                    if (uri.scheme == "https" || uri.scheme == "http") {
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                    }
                    return true
                }
            }
        }
        container.addView(dashboard, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        officialPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setBackgroundColor(0xFFF4F7FB.toInt())
        }
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(16, 12, 16, 12)
            setBackgroundColor(0xFF0E2033.toInt())
        }
        val backBtn = Button(this).apply {
            text = "← 仪表盘"
            setOnClickListener { showDashboard() }
        }
        status = TextView(this).apply {
            text = "HKU 官方页面"
            setTextColor(0xFFE2ECF5.toInt())
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(16, 0, 12, 0)
        }
        val portalBtn = Button(this).apply {
            text = "Portal/SIS"
            setOnClickListener { showOfficial(PORTAL_URL) }
        }
        val moodleBtn = Button(this).apply {
            text = "Moodle"
            setOnClickListener { showOfficial(MOODLE_CAS_URL) }
        }
        val reloadBtn = Button(this).apply {
            text = "刷新"
            setOnClickListener { if (::webView.isInitialized) webView.reload() }
        }
        toolbar.addView(backBtn)
        toolbar.addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(portalBtn)
        toolbar.addView(moodleBtn)
        toolbar.addView(reloadBtn)
        officialPanel.addView(toolbar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            cookieManager.setAcceptThirdPartyCookies(this, true)
            addJavascriptInterface(HkuPageBridge(), "MyHKU")
            setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                enqueueAuthenticatedDownload(url, userAgent, contentDisposition, mimeType)
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return if (request.url.scheme == "https" && isAllowedHost(request.url.host)) {
                        false
                    } else {
                        status.text = "已阻止非官方页面跳转"
                        true
                    }
                }

                override fun onPageFinished(view: WebView, url: String) {
                    status.text = view.title?.takeIf { it.isNotBlank() } ?: "HKU 官方认证"
                    injectReadOnlyExtractor(view)
                }
            }
        }
        officialPanel.addView(webView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f,
        ))
        container.addView(officialPanel, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        setContentView(container)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (officialPanel.visibility == View.VISIBLE) {
                    if (webView.canGoBack()) webView.goBack() else showDashboard()
                    return
                }
                if (dashboard.canGoBack()) {
                    dashboard.goBack()
                    return
                }
                isEnabled = false
                onBackPressedDispatcher.onBackPressed()
                isEnabled = true
            }
        })

        dashboard.loadUrl(DASHBOARD_ASSET_URL)
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else if (sitePayloads.isNotEmpty()) {
            // Silently revalidate the previously used official session in background.
            webView.loadUrl(MOODLE_URL)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized && webView.url != null) webView.reload()
    }

    private fun injectReadOnlyExtractor(view: WebView) {
        if (connectorSource.isNotBlank()) {
            view.evaluateJavascript(connectorSource, null)
        }
    }

    private fun notifyDashboardUpdated() {
        if (!::dashboard.isInitialized) return
        dashboard.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('myhku-native-updated')); window.renderSnapshot && window.renderSnapshot();",
            null,
        )
    }

    private fun showDashboard() {
        officialPanel.visibility = View.GONE
        dashboard.visibility = View.VISIBLE
        if (dashboard.url == null) dashboard.loadUrl(DASHBOARD_ASSET_URL)
        else notifyDashboardUpdated()
    }

    private fun showOfficial(url: String) {
        if (!isAllowedHost(Uri.parse(url).host)) return
        officialPanel.visibility = View.VISIBLE
        webView.loadUrl(url)
    }

    private fun mergeSisPayload(previousRaw: String?, incoming: JSONObject): JSONObject {
        if (previousRaw.isNullOrBlank() || !incoming.optBoolean("connected", false)) return incoming
        val previous = runCatching { JSONObject(previousRaw) }.getOrNull() ?: return incoming
        val incomingWeeks = mutableListOf<Pair<String, String>>()
        incoming.optJSONArray("scheduleWeeks")?.let { arr ->
            for (i in 0 until arr.length()) {
                val w = arr.optJSONObject(i) ?: continue
                val s = w.optString("start", ""); val e = w.optString("end", "")
                if (s.length == 10 && e.length == 10) incomingWeeks.add(s to e)
            }
        }
        incoming.optJSONObject("scheduleWeek")?.let { w ->
            val s = w.optString("start", ""); val e = w.optString("end", "")
            if (s.length == 10 && e.length == 10 && incomingWeeks.none { it.first == s && it.second == e }) {
                incomingWeeks.add(s to e)
            }
        }
        if (incomingWeeks.isEmpty()) return incoming
        val mergedSchedule = JSONArray()
        val seenIds = mutableSetOf<String>()
        previous.optJSONArray("schedule")?.let { prevArr ->
            for (i in 0 until prevArr.length()) {
                val item = prevArr.optJSONObject(i) ?: continue
                val date = item.optString("date", "").take(10)
                val inIncoming = date.length == 10 && incomingWeeks.any { (start, end) -> date >= start && date <= end }
                if (date.length == 10 && !inIncoming) {
                    val id = item.optString("id", "")
                    if (id.isEmpty() || seenIds.add(id)) mergedSchedule.put(item)
                }
            }
        }
        incoming.optJSONArray("schedule")?.let { nextArr ->
            for (i in 0 until nextArr.length()) {
                val item = nextArr.optJSONObject(i) ?: continue
                val id = item.optString("id", "")
                if (id.isEmpty() || seenIds.add(id)) mergedSchedule.put(item)
            }
        }
        val weeksMap = linkedMapOf<String, JSONObject>()
        for (source in listOf(previous.optJSONArray("scheduleWeeks"), incoming.optJSONArray("scheduleWeeks"))) {
            source ?: continue
            for (i in 0 until source.length()) {
                val w = source.optJSONObject(i) ?: continue
                val s = w.optString("start", ""); val e = w.optString("end", "")
                if (s.length == 10 && e.length == 10) weeksMap["$s..$e"] = JSONObject().put("start", s).put("end", e)
            }
        }
        incomingWeeks.forEach { (s, e) -> weeksMap.putIfAbsent("$s..$e", JSONObject().put("start", s).put("end", e)) }
        val mergedWeeks = JSONArray()
        weeksMap.entries.sortedBy { it.key }.forEach { mergedWeeks.put(it.value) }
        incoming.put("schedule", mergedSchedule)
        incoming.put("scheduleWeeks", mergedWeeks)
        return incoming
    }

    private inner class HkuPageBridge {
        @android.webkit.JavascriptInterface
        fun ingest(payload: String) {
            val parsed = runCatching { JSONObject(payload) }.getOrNull() ?: return
            val sourceHost = parsed.optString("site", "").lowercase()
            val siteKey = parsed.optString("siteKey", "").ifBlank {
                when (sourceHost) {
                    "moodle.hku.hk" -> "moodle"
                    "studentportal.hku.hk" -> "portal"
                    "hkuportal.hku.hk", "sis-main.hku.hk", "sweb.hku.hk", "intraweb.hku.hk" -> "sis"
                    else -> ""
                }
            }
            if (siteKey !in setOf("moodle", "portal", "sis")) return
            val effective = if (siteKey == "sis") mergeSisPayload(sitePayloads["sis"], parsed) else parsed
            val serialized = effective.toString()
            sitePayloads[siteKey] = serialized
            if (siteKey == "portal" && effective.optBoolean("connected", false) && (effective.optJSONArray("schedule")?.length() ?: 0) > 0) {
                sitePayloads["sis"] = mergeSisPayload(sitePayloads["sis"], JSONObject(serialized).put("siteKey", "sis")).toString()
            }
            latestPayload = combinePayloads()
            snapshotPrefs?.edit()?.apply {
                putString(siteKey, sitePayloads[siteKey])
                sitePayloads["sis"]?.let { putString("sis", it) }
                putString("latest", latestPayload)
            }?.apply()
            CookieManager.getInstance().flush()
            runOnUiThread {
                val connected = effective.optBoolean("connected", false)
                status.text = if (connected) "已同步 · ${effective.optString("detail", siteKey)}" else "请完成登录 · $siteKey"
                notifyDashboardUpdated()
            }
        }
    }

    private fun combinePayloads(): String {
        val combined = JSONObject().put("version", 4).put("connected", false)
        val arrays = listOf("courses", "assignments", "announcements", "resources", "grades", "schedule")
        arrays.forEach { combined.put(it, JSONArray()) }
        val seenByField = arrays.associateWith { mutableSetOf<String>() }
        val weeksMap = linkedMapOf<String, JSONObject>()
        var primaryWeek: JSONObject? = null
        var latestTime = ""
        sitePayloads.values.forEach { raw ->
            runCatching {
                val item = JSONObject(raw)
                if (item.optBoolean("connected", false)) combined.put("connected", true)
                val time = item.optString("fetchedAt", item.optString("capturedAt", ""))
                if (time > latestTime && item.optBoolean("connected", false)) {
                    latestTime = time
                    combined.put("fetchedAt", time)
                }
                item.optJSONObject("scheduleWeek")?.let { w ->
                    val s = w.optString("start", ""); val e = w.optString("end", "")
                    if (s.length == 10 && e.length == 10) {
                        primaryWeek = JSONObject().put("start", s).put("end", e)
                        weeksMap["$s..$e"] = JSONObject().put("start", s).put("end", e)
                    }
                }
                item.optJSONArray("scheduleWeeks")?.let { ws ->
                    for (i in 0 until ws.length()) {
                        val w = ws.optJSONObject(i) ?: continue
                        val s = w.optString("start", ""); val e = w.optString("end", "")
                        if (s.length == 10 && e.length == 10) weeksMap["$s..$e"] = JSONObject().put("start", s).put("end", e)
                    }
                }
                arrays.forEach { key ->
                    val target = combined.optJSONArray(key) ?: JSONArray().also { combined.put(key, it) }
                    val seen = seenByField.getValue(key)
                    val values = item.optJSONArray(key) ?: return@forEach
                    for (index in 0 until values.length()) {
                        val entry = values.optJSONObject(index) ?: continue
                        val entryId = entry.optString("id", "")
                        if (entryId.isEmpty() || seen.add(entryId)) target.put(entry)
                    }
                }
            }
        }
        primaryWeek?.let { combined.put("scheduleWeek", it) }
        if (weeksMap.isNotEmpty()) {
            val ws = JSONArray()
            weeksMap.entries.sortedBy { it.key }.forEach { ws.put(it.value) }
            combined.put("scheduleWeeks", ws)
        }
        return combined.toString()
    }

    private inner class DashboardBridge {
        @android.webkit.JavascriptInterface
        fun hasAcceptedLegal(): Boolean = hasLegalConsent()

        @android.webkit.JavascriptInterface
        fun refreshHku(): String {
            runOnUiThread {
                if (::webView.isInitialized) {
                    if (webView.url != null) webView.reload() else webView.loadUrl(MOODLE_URL)
                }
            }
            return "ok"
        }

        @android.webkit.JavascriptInterface
        fun openLogin(site: String): String {
            val target = when (site) {
                "portal" -> PORTAL_URL
                "sis" -> SIS_URL
                "moodle" -> MOODLE_CAS_URL
                else -> PORTAL_URL
            }
            runOnUiThread { showOfficial(target) }
            return getSession(site)
        }

        @android.webkit.JavascriptInterface
        fun downloadResource(url: String): Boolean = enqueueAuthenticatedDownload(url)

        @android.webkit.JavascriptInterface
        fun clearAccount(): Boolean {
            sitePayloads.clear()
            snapshotPrefs?.edit()?.clear()?.apply()
            latestPayload = "{\"version\":4,\"connected\":false}"
            runOnUiThread {
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                if (::webView.isInitialized) {
                    webView.stopLoading()
                    webView.clearCache(true)
                    webView.clearHistory()
                    webView.loadUrl("about:blank")
                }
                showDashboard()
            }
            return true
        }

        @android.webkit.JavascriptInterface
        fun getSnapshot(): String = latestPayload

        @android.webkit.JavascriptInterface
        fun getLatestSnapshot(): String = latestPayload

        @android.webkit.JavascriptInterface
        fun getSession(site: String): String = runCatching {
            val raw = sitePayloads[site] ?: return@runCatching JSONObject()
                .put("connected", false)
                .put("detail", "尚未连接官方页面")
                .toString()
            val data = JSONObject(raw)
            val connected = data.optBoolean("connected", false)
            JSONObject()
                .put("connected", connected)
                .put("checkedAt", data.optString("fetchedAt", data.optString("capturedAt", "")))
                .put("detail", data.optString("detail", if (connected) "Android 官方会话已同步" else "请在官方页面登录"))
                .toString()
        }.getOrDefault("{\"connected\":false,\"detail\":\"尚未同步\"}")
    }

    companion object {
        private const val DASHBOARD_ASSET_URL = "https://appassets.androidplatform.net/assets/dashboard-app/index.html"
        private const val MOODLE_URL = "https://moodle.hku.hk/my/"
        private const val MOODLE_CAS_URL = "https://moodle.hku.hk/login/index.php?authCAS=CAS"
        private const val PORTAL_URL = "https://studentportal.hku.hk/"
        private const val SIS_URL = "https://sweb.hku.hk/student/servlet/MyWeekly/showTimetable"
    }
}
