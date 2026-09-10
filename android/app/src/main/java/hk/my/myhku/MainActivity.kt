package hk.my.myhku

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * Android host for the official HKU sites.
 * SSO/MFA happens inside the official pages. We never inspect passwords or cookies.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var dashboard: WebView
    private lateinit var status: TextView
    private var snapshotPrefs: android.content.SharedPreferences? = null
    private var latestPayload = "{\"version\":1,\"status\":\"no_data\"}"
    private val sitePayloads = mutableMapOf<String, String>()

    private val allowedHosts = setOf(
        "moodle.hku.hk", "studentportal.hku.hk", "hkuportal.hku.hk",
        "login.microsoftonline.com"
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
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
        latestPayload = snapshotPrefs?.getString("latest", latestPayload) ?: latestPayload
        for (site in listOf("moodle", "portal", "sis")) {
            snapshotPrefs?.getString(site, null)?.let { sitePayloads[site] = it }
        }
        latestPayload = combinePayloads()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12, 8, 12, 0)
        }
        val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        status = TextView(this).apply { text = "MyHKU · ready"; setPadding(0, 8, 8, 8) }
        val refresh = Button(this).apply {
            text = "刷新"
            setOnClickListener { refreshHkuPages() }
        }
        val moodle = Button(this).apply {
            text = "Moodle"
            setOnClickListener { showOfficial(MOODLE_URL) }
        }
        val portal = Button(this).apply {
            text = "Portal / SIS"
            setOnClickListener { showOfficial(PORTAL_URL) }
        }
        val home = Button(this).apply {
            text = "概览"
            setOnClickListener { showDashboard() }
        }
        toolbar.addView(status, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(refresh)
        toolbar.addView(moodle)
        toolbar.addView(portal)
        toolbar.addView(home)
        root.addView(toolbar)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(HkuPageBridge(), "MyHKU")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val host = request.url.host?.lowercase() ?: return true
                    return if (allowedHosts.any { host == it || host.endsWith(".$it") }) {
                        false
                    } else {
                        status.text = "已阻止非 HKU 页面"
                        true
                    }
                }

                override fun onPageFinished(view: WebView, url: String) {
                    status.text = "已加载 · ${view.title ?: url}"
                    injectReadOnlyExtractor(view)
                }
            }
        }
        root.addView(webView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        dashboard = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            // The dashboard is a bundled read-only asset.
            settings.allowFileAccess = true
            addJavascriptInterface(DashboardBridge(), "MyHKUDashboard")
            addJavascriptInterface(DashboardBridge(), "myhkuAndroid")
            webViewClient = WebViewClient()
            visibility = android.view.View.GONE
        }
        root.addView(dashboard, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        setContentView(root)

        if (savedInstanceState == null) webView.loadUrl(MOODLE_URL)
        else webView.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        // Refresh once when the app returns to the foreground; no background polling.
        if (::webView.isInitialized && webView.url != null) webView.reload()
    }

    private fun refreshHkuPages() {
        if (dashboard.visibility == android.view.View.VISIBLE) {
            dashboard.evaluateJavascript("window.renderSnapshot && window.renderSnapshot()", null)
            status.text = "概览已刷新"
            return
        }
        status.text = "刷新中..."
        webView.reload()
    }

    private fun injectReadOnlyExtractor(view: WebView) {
        view.evaluateJavascript(READ_ONLY_EXTRACTOR, null)
    }

    private fun showDashboard() {
        webView.visibility = android.view.View.GONE
        dashboard.visibility = android.view.View.VISIBLE
        if (dashboard.url == null) dashboard.loadUrl("file:///android_asset/dashboard-app/index.html")
        else dashboard.evaluateJavascript("window.renderSnapshot && window.renderSnapshot()", null)
        status.text = "概览 · 最近一次读取结果"
    }

    private fun showOfficial(url: String) {
        dashboard.visibility = android.view.View.GONE
        webView.visibility = android.view.View.VISIBLE
        webView.loadUrl(url)
    }

    private inner class HkuPageBridge {
        @android.webkit.JavascriptInterface
        fun ingest(payload: String) {
            // Payload is normalized page data only. It is intentionally not persisted here.
            latestPayload = runCatching { JSONObject(payload).toString() }.getOrDefault("{\"status\":\"invalid_data\"}")
            val source = runCatching { JSONObject(latestPayload).optString("site", "") }.getOrDefault("")
            val site = when (source) {
                "moodle.hku.hk" -> "moodle"
                "studentportal.hku.hk" -> "portal"
                "hkuportal.hku.hk" -> "sis"
                else -> "latest"
            }
            sitePayloads[site] = latestPayload
            latestPayload = combinePayloads()
            snapshotPrefs?.edit()?.apply {
                putString(site, sitePayloads[site])
                putString("latest", latestPayload)
            }?.apply()
            runOnUiThread {
                val size = runCatching { JSONObject(payload).toString().length }.getOrDefault(0)
                status.text = "已读取页面数据 · ${size} 字符"
                if (dashboard.visibility == android.view.View.VISIBLE) {
                    dashboard.evaluateJavascript("window.renderSnapshot && window.renderSnapshot()", null)
                }
            }
        }
    }

    private fun combinePayloads(): String {
        val combined = JSONObject().put("version", 3).put("connected", false)
        val arrays = listOf("courses", "assignments", "announcements", "resources", "grades", "schedule")
        arrays.forEach { combined.put(it, org.json.JSONArray()) }
        var latestTime = ""
        sitePayloads.values.forEach { raw ->
            runCatching {
                val item = JSONObject(raw)
                if (item.optBoolean("connected", false)) combined.put("connected", true)
                val host = item.optString("site", "")
                if (host.isNotEmpty()) combined.put("site", host)
                val time = item.optString("fetchedAt", item.optString("capturedAt", ""))
                if (time > latestTime) { latestTime = time; combined.put("fetchedAt", time) }
                arrays.forEach { key ->
                    val target = combined.optJSONArray(key) ?: org.json.JSONArray().also { combined.put(key, it) }
                    val values = item.optJSONArray(key) ?: return@forEach
                    for (index in 0 until values.length()) target.put(values.opt(index))
                }
            }
        }
        return combined.toString()
    }

    private inner class DashboardBridge {
        @android.webkit.JavascriptInterface
        fun refreshHku(): String {
            runOnUiThread { if (::webView.isInitialized) webView.reload() }
            return "ok"
        }

        @android.webkit.JavascriptInterface
        fun getLatestSnapshot(): String = latestPayload

        @android.webkit.JavascriptInterface
        fun getSession(site: String): String = runCatching {
            val data = JSONObject(sitePayloads[site] ?: latestPayload)
            val host = data.optString("site", "")
            val matches = when (site) {
                "moodle" -> host == "moodle.hku.hk"
                "portal" -> host == "studentportal.hku.hk"
                "sis" -> host == "studentportal.hku.hk" || host == "hkuportal.hku.hk"
                else -> false
            }
            JSONObject()
                .put("connected", matches && data.optBoolean("connected", false))
                .put("checkedAt", data.optString("fetchedAt", data.optString("capturedAt", "")))
                .put("detail", if (matches) "Android WebView 页面已读取" else "尚未从官方页面同步")
                .toString()
        }.getOrDefault("{\"connected\":false,\"detail\":\"尚未同步\"}")
    }

    companion object {
        private const val MOODLE_URL = "https://moodle.hku.hk/"
        private const val PORTAL_URL = "https://studentportal.hku.hk/"

        // Deliberately limited to visible Moodle/SIS fields and HKU links. No cookies, storage, forms, or raw HTML.
        private const val READ_ONLY_EXTRACTOR = """
            (() => {
              const clean = (value, max=500) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
              const visible = el => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
              const safe = value => { try { const u=new URL(value, location.href); return u.protocol==='https:' && (u.hostname==='hku.hk'||u.hostname.endsWith('.hku.hk')) ? u.toString() : ''; } catch (_) { return ''; } };
              const text = (root, selectors=[]) => { for (const selector of selectors) { const el=root?.querySelector(selector); const value=clean(el?.textContent); if(value) return value; } return ''; };
              const id = (prefix, value) => prefix+'-'+Array.from(clean(value)).reduce((h,c)=>(Math.imul(h^c.charCodeAt(0),16777619)>>>0).toString(16), '811c9dc5');
              const login = Boolean(document.querySelector('input[type=password]')) || /\/(?:login|signin|sign-in|cas)(?:\/|\.|$)/i.test(location.pathname);
              if (login) { window.MyHKU.ingest(JSON.stringify({version:3, site:location.hostname, connected:false, fetchedAt:new Date().toISOString()})); return; }
              const host=location.hostname.toLowerCase();
              const payload={version:3, site:host, connected:true, fetchedAt:new Date().toISOString(), courses:[], assignments:[], announcements:[], resources:[], grades:[], schedule:[]};
              if (host==='moodle.hku.hk') {
                const seen={courses:new Set(),assignments:new Set(),announcements:new Set(),resources:new Set(),grades:new Set()};
                document.querySelectorAll('a[href*="/course/view.php"]').forEach(a=>{ const title=clean(a.textContent); const href=safe(a.href); if(!title) return; const key=a.href; if(seen.courses.has(key)) return; seen.courses.add(key); payload.courses.push({id:id('course',key),title,url:href}); });
                document.querySelectorAll('a[href*="/mod/assign/"],a[href*="assign/view"]').forEach(a=>{ const root=a.closest('tr,article,li,.activity,.activity-item')||a; const title=clean(a.textContent)||text(root,['.activityname','.instancename','h3','h4']); const href=safe(a.href); if(!title||!href) return; const key=a.href; if(seen.assignments.has(key)) return; seen.assignments.add(key); const time=root.querySelector('time[datetime],time,.duedate,.due-date'); payload.assignments.push({id:id('assignment',key),title,course:text(root,['.course-name','.coursename'])||'未提供课程',...(time?{due:clean(time.getAttribute('datetime')||time.textContent,120)}:{})}); });
                document.querySelectorAll('a[href*="/mod/resource/"],a[href*="/mod/folder/"],a[href*="/mod/url/"],a[href*="/mod/page/"]').forEach(a=>{ const title=clean(a.textContent)||clean(a.getAttribute('aria-label')); const href=safe(a.href); if(!title||!href||seen.resources.has(href)) return; seen.resources.add(href); payload.resources.push({id:id('resource',href),title,course:'未提供课程',url:href}); });
                document.querySelectorAll('a[href*="/mod/forum/"]').forEach(a=>{ const title=clean(a.textContent), href=safe(a.href); if(!title||!href||seen.announcements.has(href)) return; seen.announcements.add(href); payload.announcements.push({id:id('announcement',href),title,course:'未提供课程',url:href}); });
                document.querySelectorAll('table.grades tr,table.user-grade tr').forEach(row=>{ const cells=[...row.querySelectorAll('th,td')].map(c=>clean(c.textContent)).filter(Boolean); if(cells.length<2) return; const title=cells[0]; if(!/(grade|score|mark|成绩|分数)/i.test(cells.join(' '))) return; const value=cells.slice(1).find(v=>/\d+(?:\.\d+)?/.test(v))||''; payload.grades.push({id:id('grade',title),title,course:'未提供课程',...(value?{value}:{})}); });
              } else {
                document.querySelectorAll('table').forEach(table=>{ const headers=[...table.querySelectorAll('thead th')].map(c=>clean(c.textContent).toLowerCase()); [...table.querySelectorAll('tbody tr,tr')].forEach(row=>{ const cells=[...row.querySelectorAll('th,td')].map(c=>clean(c.textContent)); const whole=cells.join(' · '); const times=whole.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/gi)||[]; if(cells.length<2||times.length<2) return; const find=patterns=>{const i=headers.findIndex(h=>patterns.some(p=>p.test(h)));return i>=0?cells[i]:''}; const title=find([/course|subject|class|课程|科目/])||cells[0]; const code=find([/code|编号/]); const room=find([/room|location|venue|地点|教室/]); const teacher=find([/teacher|instructor|lecturer|教师|老师/]); payload.schedule.push({id:id('class',title+times[0]+times[1]),title, ...(code?{code}:{}),start:times[0],end:times[1],...(room?{room}:{}),...(teacher?{teacher}:{})}); }); });
              }
              window.MyHKU.ingest(JSON.stringify(payload));
            })();
        """
    }
}
