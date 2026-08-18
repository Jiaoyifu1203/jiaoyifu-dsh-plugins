/**
 * jiaoyifu-studio · 工作台面板（单文件 HTML，零构建）
 *
 * 复刻笔记《DeepSeek Harness 爆改自媒体工作台》的三栏工作台：
 *   左：内容库列表（封面/标题/状态/相对时间，可搜索、新建、刷新）
 *   中：五 Tab 详情（概览 = 选题卡 + 五平台状态卡；视频 = 内嵌播放器；脚本/字幕/文章）
 *   右（弱化）：动作区并入概览头部（在 DSH 里绑定本期 = 复制 /content <slug>）
 *
 * 约束：整个 HTML 被 TS 模板字符串包裹 —— 面板 JS 内禁用反引号与 ${。
 */
export const PANEL_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>内容工作台 · Jiaoyifu Studio</title>
<style>
:root{
  --bg:#0b0e14; --panel:#12161f; --panel2:#171c27; --border:#252c3a;
  --text:#e6edf3; --muted:#8b949e; --accent:#4d6bfe;
  --green:#3fb950; --amber:#d29922; --blue:#58a6ff; --red:#f85149;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif;display:flex;flex-direction:column}
a{color:var(--blue);text-decoration:none}
button{font-family:inherit}

.topbar{display:flex;align-items:center;gap:12px;padding:0 16px;height:52px;border-bottom:1px solid var(--border);background:var(--panel);flex-shrink:0}
.brand-badge{font-size:11px;letter-spacing:.12em;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:2px 8px;font-weight:600}
.topbar h1{font-size:15px;font-weight:650;margin-left:2px}
.slogan{color:var(--muted);font-size:12px;margin-left:6px}
.top-actions{margin-left:auto;display:flex;gap:8px}

.btn{background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;white-space:nowrap}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.small{padding:3px 9px;font-size:12px}
.btn:disabled{opacity:.5;cursor:default}

.main{flex:1;display:flex;min-height:0}
.side{width:300px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--panel);min-height:0}
.side-tools{padding:10px;display:flex;gap:8px;border-bottom:1px solid var(--border)}
.search{flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:13px;outline:none}
.search:focus{border-color:var(--accent)}
.items{flex:1;overflow-y:auto;padding:8px}
.item{display:flex;gap:10px;padding:10px;border-radius:10px;cursor:pointer;border:1px solid transparent;margin-bottom:4px;align-items:center}
.item:hover{background:var(--panel2)}
.item.active{background:var(--panel2);border-color:var(--accent)}
.thumb{width:64px;height:40px;border-radius:6px;object-fit:cover;background:var(--panel2);border:1px solid var(--border);flex-shrink:0}
.thumb-ph{width:64px;height:40px;border-radius:6px;background:var(--panel2);border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.item-body{min-width:0;flex:1}
.item-title{font-size:13px;font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item-meta{font-size:11px;color:var(--muted);margin-top:2px;display:flex;gap:6px;align-items:center}
.side-foot{padding:8px 12px;border-top:1px solid var(--border);color:var(--muted);font-size:11px}

.detail{flex:1;min-width:0;display:flex;flex-direction:column}
.dhead{padding:18px 22px 0;flex-shrink:0}
.dtitle-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dtitle{font-size:19px;font-weight:700}
.dslug{color:var(--muted);font-size:12px;font-family:ui-monospace,Menlo,monospace}
.dactions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.tabs{display:flex;gap:2px;padding:14px 22px 0;flex-shrink:0}
.tab{padding:8px 16px;border-radius:8px 8px 0 0;cursor:pointer;color:var(--muted);font-size:13px;border-bottom:2px solid transparent}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);border-bottom-color:var(--accent);font-weight:600}
.dbody{flex:1;overflow-y:auto;padding:18px 22px 28px;min-height:0}

.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px}
.card h3{font-size:12px;color:var(--muted);letter-spacing:.08em;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.card h3 .file{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--blue)}
.topic-text{white-space:pre-wrap;font-size:14px}
.md{font-size:14px}
.md h1,.md h2,.md h3,.md h4{margin:14px 0 6px;line-height:1.4}
.md h1{font-size:19px}.md h2{font-size:17px}.md h3{font-size:15px}.md h4{font-size:14px}
.md p{margin:6px 0}
.md ul,.md ol{margin:6px 0 6px 22px}
.md li{margin:2px 0}
.md code{background:var(--panel2);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.md pre{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px;overflow-x:auto;margin:8px 0}
.md pre code{background:none;border:none;padding:0}
.md blockquote{border-left:3px solid var(--accent);padding:2px 12px;color:var(--muted);margin:8px 0}
.md a{color:var(--blue)}
.md hr{border:none;border-top:1px solid var(--border);margin:12px 0}

.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;line-height:1.5;white-space:nowrap}
.st-not{background:rgba(110,118,129,.15);color:#9aa3ad;border:1px solid rgba(110,118,129,.4)}
.st-pre{background:rgba(210,153,34,.12);color:var(--amber);border:1px solid rgba(210,153,34,.4)}
.st-ready{background:rgba(88,166,255,.12);color:var(--blue);border:1px solid rgba(88,166,255,.4)}
.st-pub{background:rgba(63,185,80,.12);color:var(--green);border:1px solid rgba(63,185,80,.4)}
.pu-not{color:#9aa3ad}
.pu-draft{background:rgba(210,153,34,.12);color:var(--amber);border:1px solid rgba(210,153,34,.4)}
.pu-pub{background:rgba(63,185,80,.12);color:var(--green);border:1px solid rgba(63,185,80,.4)}

select.status-select{background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:4px 8px;font-size:12.5px;outline:none}

.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.pcard{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px}
.pcard-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.pname{font-weight:600;font-size:13.5px}
.pstats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.pstat label{display:block;font-size:11px;color:var(--muted);margin-bottom:2px}
.pstat input,.purl input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text);font-size:12.5px;outline:none}
.pstat input:focus,.purl input:focus{border-color:var(--accent)}
.purl{margin-bottom:10px}
.pcard-actions{display:flex;justify-content:flex-end;gap:6px;align-items:center}
.pcard .pu-note{font-size:11px;color:var(--muted)}

video{width:100%;max-height:62vh;border-radius:12px;background:#000;border:1px solid var(--border);outline:none}
.vstages{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.vstage{display:flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:12.5px;color:var(--muted)}
.vstage.done{color:var(--text);border-color:rgba(63,185,80,.5)}
.vstage .dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0}
.vstage.done .dot{background:var(--green)}
.vstage .vnote{font-size:11px;color:var(--muted)}
.varrow{color:var(--muted);font-size:12px}
.vcontrols{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.vchk{display:flex;align-items:center;gap:4px;font-size:12.5px;color:var(--text)}
.vfoot{margin-top:12px;font-size:12px;color:var(--muted)}
.subline{display:flex;gap:12px;padding:8px 10px;border-radius:8px;cursor:pointer;align-items:baseline}
.subline:hover{background:var(--panel2)}
.subline .t{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--blue);flex-shrink:0;width:74px}
.subline .x{font-size:13.5px}

.empty{margin:80px auto;max-width:520px;text-align:center;color:var(--muted)}
.empty .big{font-size:40px;margin-bottom:14px}
.empty h2{color:var(--text);font-size:17px;margin-bottom:10px}
.empty p{margin:6px 0;font-size:13.5px}
.empty code{background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:1px 8px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:var(--blue)}

.foot{border-top:1px solid var(--border);padding:8px 16px;color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:12px;flex-shrink:0;background:var(--panel)}
.foot code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--muted)}

.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--accent);padding:8px 18px;border-radius:999px;opacity:0;transition:opacity .25s;pointer-events:none;font-size:13px;z-index:99}
.toast.show{opacity:1}

.hint{font-size:12.5px;color:var(--muted);background:rgba(77,107,254,.08);border:1px solid rgba(77,107,254,.3);border-radius:8px;padding:8px 12px;margin-bottom:14px}
@media (max-width:900px){
  .main{flex-direction:column}
  .side{width:100%;max-height:38vh;border-right:none;border-bottom:1px solid var(--border)}
  .slogan{display:none}
}
</style>
</head>
<body>
<div class="topbar">
  <span class="brand-badge">JIAOYIFU STUDIO</span>
  <h1>内容工作台</h1>
  <span class="slogan">本地目录 · 对话创作 · 多平台同步</span>
  <div class="top-actions">
    <button class="btn" data-act="refresh">刷新</button>
    <a class="btn" href="/" target="_blank">打开 DSH 会话</a>
  </div>
</div>
<div class="main">
  <aside class="side">
    <div class="side-tools">
      <input class="search" id="search" placeholder="搜索标题 / slug…" data-act="search">
      <button class="btn primary" data-act="new-item" title="新建一期内容">＋ 新建</button>
    </div>
    <div class="items" id="items"></div>
    <div class="side-foot" id="side-foot">加载中…</div>
  </aside>
  <section class="detail" id="detail">
    <div class="empty">
      <div class="big">🎬</div>
      <h2>脚姨夫内容工作台</h2>
      <p>👈 点击左侧一期内容，进入 概览 / 视频 / 脚本 / 字幕 / 文章</p>
      <p>在 DSH 会话里说「帮我新建一期《标题》」即可开始创作，</p>
      <p>或用 <code>/content &lt;slug&gt;</code> 把某一期绑进对话上下文。</p>
    </div>
  </section>
</div>
<div class="foot">
  <span>内容根目录：<code id="root-path">~/.dsh/content</code></span>
  <span>发布铁律：自动发布只写草稿，公开动作留给人。</span>
</div>
<div class="toast" id="toast"></div>
<script>
(function(){
  'use strict';
  var PANEL_BASE = location.pathname.replace(/\\/$/, '');
  var list = [];
  var current = null;
  var autoOpened = false;
  var searchText = '';
  var listTimer = null;
  var detailTimer = null;

  var STATUS_CONF = {
    not_started: { label: '未开始', cls: 'st-not' },
    preparing: { label: '准备中', cls: 'st-pre' },
    ready: { label: '待发布', cls: 'st-ready' },
    published: { label: '已发布', cls: 'st-pub' }
  };
  var PUB_CONF = {
    unpublished: { label: '未发布', cls: 'pu-not' },
    draft: { label: '草稿已备', cls: 'pu-draft' },
    published: { label: '已发布', cls: 'pu-pub' }
  };
  var PLATFORMS = [
    { key: 'xhs', label: '小红书' },
    { key: 'bilibili', label: 'B站' },
    { key: 'douyin', label: '抖音' },
    { key: 'shipinhao', label: '视频号' },
    { key: 'gzh', label: '公众号' }
  ];

  function qs(sel, root) { return (root || document).querySelector(sel) }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function toast(msg) {
    var t = qs('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show') }, 2200);
  }
  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) { return r.json() })
  }
  function postJson(url, body) {
    return fetchJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
  function timeAgo(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    var p = function (n) { return String(n).padStart(2, '0') };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function pill(label, cls) { return '<span class="pill ' + cls + '">' + esc(label) + '</span>' }
  function statusPill(status) {
    var c = STATUS_CONF[status] || STATUS_CONF.not_started;
    return pill(c.label, c.cls)
  }
  function pubPill(status) {
    var c = PUB_CONF[status] || PUB_CONF.unpublished;
    return pill(c.label, c.cls)
  }
  function copyText(text, done) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(done || '已复制'); } catch (e) { toast('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(done || '已复制'); }, fallback);
    } else fallback();
  }

  // ---------- Markdown 轻渲染 ----------
  function inlineMd(s) {
    var out = esc(s);
    out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    out = out.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    out = out.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return out;
  }
  function mdToHtml(t) {
    var lines = String(t || '').replace(/\\r/g, '').split('\\n');
    var out = [];
    var inCode = false;
    var inList = false;
    var inQuote = false;
    var closeList = function () { if (inList) { out.push('</ul>'); inList = false } };
    var closeQuote = function () { if (inQuote) { out.push('</blockquote>'); inQuote = false } };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\`\`\`/.test(line.trim())) {
        closeList(); closeQuote();
        if (inCode) { out.push('</code></pre>'); inCode = false; }
        else { out.push('<pre><code>'); inCode = true; }
        continue;
      }
      if (inCode) { out.push(esc(line)); continue; }
      var m = line.match(/^(#{1,4})\\s+(.*)$/);
      if (m) {
        closeList(); closeQuote();
        var lv = m[1].length;
        out.push('<h' + lv + '>' + inlineMd(m[2]) + '</h' + lv + '>');
        continue;
      }
      if (/^>\\s?/.test(line)) {
        closeList();
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        out.push(inlineMd(line.replace(/^>\\s?/, '')));
        continue;
      }
      var li = line.match(/^\\s*[-*]\\s+(.*)$/) || line.match(/^\\s*\\d+\\.\\s+(.*)$/);
      if (li) {
        closeQuote();
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inlineMd(li[1]) + '</li>');
        continue;
      }
      if (line.trim() === '') { closeList(); closeQuote(); out.push('<p></p>'); continue; }
      if (/^---+$/.test(line.trim())) { closeList(); closeQuote(); out.push('<hr>'); continue; }
      closeList(); closeQuote();
      out.push('<p>' + inlineMd(line) + '</p>');
    }
    closeList(); closeQuote();
    if (inCode) out.push('</code></pre>');
    return out.join('\\n');
  }

  // ---------- SRT ----------
  function srtTimeToSec(t) {
    var p = String(t || '').split(':');
    if (p.length < 3) return 0;
    var s = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60;
    var last = p[2].replace(',', '.');
    return s + parseFloat(last);
  }
  function srtBlocks(t) {
    var blocks = [];
    var parts = String(t || '').replace(/\\r/g, '').split(/\\n\\n+/);
    for (var i = 0; i < parts.length; i++) {
      var lines = parts[i].split('\\n');
      var ti = -1;
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].indexOf(' --> ') >= 0) { ti = j; break }
      }
      if (ti < 0) continue;
      var times = lines[ti].split(' --> ');
      var text = lines.slice(ti + 1).join(' ').trim();
      if (text) blocks.push({ start: srtTimeToSec(times[0]), label: times[0].split(',')[0], text: text });
    }
    return blocks;
  }

  // ---------- 列表 ----------
  function loadList(openSlug) {
    return fetchJson(PANEL_BASE + '/api/list').then(function (data) {
      if (!data || !data.ok) { toast('加载列表失败'); return }
      list = data.items || [];
      if (data.root) { qs('#root-path').textContent = data.root }
      renderList(openSlug);
    }).catch(function () { toast('无法连接工作台服务') });
  }
  function renderList(openSlug) {
    var box = qs('#items');
    var q = searchText.trim().toLowerCase();
    var items = q ? list.filter(function (m) {
      return (m.title || '').toLowerCase().indexOf(q) >= 0 || (m.slug || '').toLowerCase().indexOf(q) >= 0
    }) : list;
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var thumb = m.hasCover
        ? '<img class="thumb" src="' + PANEL_BASE + '/api/media?slug=' + encodeURIComponent(m.slug) + '&file=cover.' + m.coverExt + '" alt="">'
        : '<div class="thumb-ph">🎬</div>';
      var isActive = current && current.slug === m.slug;
      html += '<div class="item' + (isActive ? ' active' : '') + '" data-act="open-item" data-slug="' + esc(m.slug) + '">' +
        thumb +
        '<div class="item-body">' +
          '<div class="item-title">' + esc(m.title) + '</div>' +
          '<div class="item-meta">' + statusPill(m.status) + '<span>' + timeAgo(m.updatedAt) + '</span></div>' +
        '</div></div>';
    }
    if (!items.length) {
      html = '<div class="empty" style="margin:40px 12px"><div class="big">📂</div>' +
        '<p style="font-size:13px">内容库为空' + (q ? '（无匹配）' : '') + '</p>' +
        (q ? '' : '<p style="font-size:12px">点「＋ 新建」，或在 DSH 对话里说：<br><code>帮我新建一期《标题》</code></p>') +
        '</div>';
    }
    box.innerHTML = html;
    qs('#side-foot').textContent = '共 ' + list.length + ' 期 · 点击查看详情';
    if (openSlug) openItem(openSlug, true);
    else if (!autoOpened && !current && list.length) {
      autoOpened = true;
      openItem(list[0].slug, true);
    }
  }

  // ---------- 详情 ----------
  function openItem(slug, keepTab) {
    fetchJson(PANEL_BASE + '/api/item?slug=' + encodeURIComponent(slug)).then(function (data) {
      if (!data || !data.ok) { toast('找不到该期内容'); return }
      current = data.item;
      var tab = keepTab ? (currentTab || 'overview') : 'overview';
      renderDetail(tab);
      renderList();
    }).catch(function () { toast('加载详情失败') });
  }
  var currentTab = 'overview';
  var busy = null;
  var videoProbe = null;
  function switchTab(name) {
    currentTab = name;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    var body = qs('#tab-body');
    if (!current) return;
    if (name === 'overview') body.innerHTML = overviewHtml(current);
    else if (name === 'video') body.innerHTML = videoHtml(current);
    else if (name === 'script') body.innerHTML = docHtml('script.md', current.files.script, '脚本') + docHtml('storyboard.md', current.files.storyboard, '分镜表');
    else if (name === 'subs') body.innerHTML = subsHtml(current) + docHtml('storyboard.md', current.files.storyboard, '分镜表');
    else if (name === 'article') body.innerHTML = docHtml('article.md', current.files.article, '文章');
  }
  function renderDetail(tab) {
    if (!current) return;
    var head = qs('#detail');
    var oldBody = qs('#tab-body');
    var scrollTop = oldBody ? oldBody.scrollTop : 0;
    var tabs = '<div class="tabs">' +
      tabBtn('overview', '概览') + tabBtn('video', '视频') + tabBtn('script', '脚本') +
      tabBtn('subs', '字幕') + tabBtn('article', '文章') +
      '</div><div class="dbody" id="tab-body"></div>';
    var headHtml =
      '<div class="dhead">' +
        '<div class="dtitle-row">' +
          '<span class="dtitle">' + esc(current.title) + '</span>' + statusPill(current.status) +
          '<span class="dslug">' + esc(current.slug) + '</span>' +
        '</div>' +
        '<div class="dactions">' +
          '<button class="btn primary" data-act="copy-command">在 DSH 里绑定本期</button>' +
          '<button class="btn" data-act="copy-path">复制目录</button>' +
          '<button class="btn" data-act="start-prep"' + (current.status === 'not_started' ? '' : ' disabled') + '>开始准备</button>' +
          statusSelectHtml(current.status) +
          '<span style="color:var(--muted);font-size:12px;align-self:center">更新 ' + timeAgo(current.updatedAt) + '</span>' +
        '</div>' +
      '</div>';
    head.innerHTML = headHtml + tabs;
    switchTab(tab);
    var newBody = qs('#tab-body');
    if (newBody) newBody.scrollTop = scrollTop;
  }
  function tabBtn(name, label) {
    return '<div class="tab" data-act="tab" data-tab="' + name + '">' + label + '</div>';
  }

  function statusSelectHtml(cur) {
    var opts = [
      ['not_started', '未开始'], ['preparing', '准备中'], ['ready', '待发布'], ['published', '已发布']
    ];
    var html = '<select class="status-select" data-act="status-select">';
    for (var i = 0; i < opts.length; i++) {
      html += '<option value="' + opts[i][0] + '"' + (cur === opts[i][0] ? ' selected' : '') + '>' + opts[i][1] + '</option>';
    }
    return html + '</select>';
  }

  function overviewHtml(item) {
    var topic = (item.files.topic || '').trim();
    var html = '';
    html += '<div class="hint">围绕本期的写/改交给 DSH 对话：点「在 DSH 里绑定本期」后把命令粘进会话，模型会自动带上本期选题、脚本与平台状态。</div>';

    html += '<div class="card"><h3>📌 选题 <span class="file">topic.md</span></h3>';
    if (topic) html += '<div class="topic-text">' + esc(topic) + '</div>';
    else html += '<div class="topic-text" style="color:var(--muted)">（还没有选题：在 DSH 对话里说「帮我定这一期的选题，写进 topic.md」）</div>';
    html += '</div>';

    html += '<div class="card"><h3>📺 多平台发布状态 <span class="file">meta.json · publish/</span></h3>';
    html += '<div class="vcontrols" style="margin-bottom:12px">';
    html += '<button class="btn primary" data-act="publish-pack"' + (busy ? ' disabled' : '') + '>' + (busy === 'pack' ? '生成中…' : '生成发布包') + '</button>';
    html += '<select class="status-select" id="pub-platform">';
    for (var pi = 0; pi < PLATFORMS.length; pi++) {
      html += '<option value="' + PLATFORMS[pi].key + '">' + PLATFORMS[pi].label + '</option>';
    }
    html += '</select>';
    html += '<button class="btn" data-act="publish-draft"' + (busy ? ' disabled' : '') + '>' + (busy === 'draft' ? '填入中…' : '填草稿') + '</button>';
    html += '<span class="pu-note">只填草稿，不点发布</span>';
    html += '</div>';
    html += '<div class="pgrid">';
    for (var i = 0; i < PLATFORMS.length; i++) {
      html += platformCardHtml(item, PLATFORMS[i]);
    }
    html += '</div></div>';
    return html;
  }

  function platformCardHtml(item, pf) {
    var p = (item.platforms && item.platforms[pf.key]) || { publishStatus: 'unpublished' };
    var html = '<div class="pcard" id="pf-' + pf.key + '">';
    html += '<div class="pcard-head"><span class="pname">' + pf.label + '</span>' + pubPill(p.publishStatus) + '</div>';
    html += '<div class="pstats">';
    var stats = [['plays', '播放'], ['likes', '赞'], ['comments', '评论'], ['favorites', '藏']];
    for (var i = 0; i < stats.length; i++) {
      var v = p[stats[i][0]];
      html += '<div class="pstat"><label>' + stats[i][1] + '</label><input type="number" min="0" data-stat="' + stats[i][0] + '" value="' + (v === undefined || v === null ? '' : v) + '"></div>';
    }
    html += '</div>';
    html += '<div class="purl"><input type="text" data-stat="url" placeholder="作品链接" value="' + esc(p.url || '') + '"></div>';
    var statusOpts = [['unpublished', '未发布'], ['draft', '草稿已备'], ['published', '已发布']];
    html += '<div class="pcard-actions">';
    html += '<select class="status-select" data-stat="publishStatus">';
    for (var j = 0; j < statusOpts.length; j++) {
      html += '<option value="' + statusOpts[j][0] + '"' + (p.publishStatus === statusOpts[j][0] ? ' selected' : '') + '>' + statusOpts[j][1] + '</option>';
    }
    html += '</select>';
    html += '<button class="btn small primary" data-act="save-platform" data-key="' + pf.key + '">保存</button>';
    html += '</div>';
    var facts = (item.publishFacts && item.publishFacts[pf.key]) || {};
    var packNote = facts.exists ? ('已生成 ' + (facts.pack || ('publish/' + pf.key + '.md'))) : '发布包未生成';
    var statusNote = p.publishStatus === 'published' ? '已公开' : p.publishStatus === 'draft' ? '草稿已备，公开前人工确认' : '';
    html += '<div class="pu-note" style="margin-top:8px">' + packNote + (statusNote ? ' · ' + statusNote : '') + '</div>';
    html += '</div>';
    return html;
  }

  function videoHtml(item) {
    var html = '';
    if (item.hasVideo) {
      html += '<div class="card"><h3>🎞️ 成片预览 <span class="file">video.mp4</span></h3>' +
        '<video id="studio-video" controls preload="metadata" src="' + esc(item.videoUrl) + '"></video></div>';
    }
    var v = item.video || {};
    var facts = item.videoFacts || {};
    var scriptChars = String(item.files.script || '').trim().length;
    var voiceCount = facts.voiceCount || 0;
    var hasSrt = !!String(item.files.subs || '').trim();
    var hasBoard = !!(facts.storyboard || (item.files && String(item.files.storyboard || '').trim()));
    var boardNote = '待生成';
    if (hasBoard) {
      boardNote = (v.storyboard && v.storyboard.shots) ? (v.storyboard.shots + ' 镜') : '已生成';
    }
    var stages = [
      { name: '文案', done: scriptChars > 0, note: scriptChars > 0 ? scriptChars + ' 字' : '待写' },
      { name: '配音', done: voiceCount > 0, note: voiceCount > 0 ? voiceCount + ' 段' + (v.durationSec ? ' / ' + v.durationSec + 's' : '') : '待生成' },
      { name: '字幕', done: hasSrt, note: hasSrt ? 'SRT 就绪' : '待生成' },
      { name: '分镜', done: hasBoard, note: boardNote },
      { name: '合成', done: item.hasVideo, note: item.hasVideo ? (v.durationSec ? v.durationSec + 's' : '已合成') : '待合成' }
    ];
    html += '<div class="card"><h3>🎬 视频生产流水线 <span class="file">升级自 MoneyPrinterTurbo · 本机 say + ffmpeg，零 API</span></h3>';
    html += '<div class="vstages">';
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      html += '<div class="vstage' + (s.done ? ' done' : '') + '"><span class="dot"></span>' + s.name + '<span class="vnote">' + esc(s.note) + '</span></div>';
      if (i < stages.length - 1) html += '<div class="varrow">→</div>';
    }
    html += '</div>';
    var p = videoProbe;
    var sayOk = p ? p.probe.say : true;
    var ffmpegOk = p ? p.probe.ffmpeg : true;
    html += '<div class="vcontrols">';
    html += '<select class="status-select" id="vd-voice">';
    if (p && p.zhVoices && p.zhVoices.length) {
      for (var j = 0; j < p.zhVoices.length; j++) {
        var vn = p.zhVoices[j];
        var sel = (v.voice && vn === v.voice) || (!v.voice && p.defaultVoice && vn === p.defaultVoice);
        html += '<option value="' + esc(vn) + '"' + (sel ? ' selected' : '') + '>' + esc(vn) + '</option>';
      }
    } else {
      html += '<option value="">默认音色</option>';
    }
    html += '</select>';
    html += '<button class="btn" data-act="video-voice"' + (busy || !sayOk ? ' disabled' : '') + '>' + (busy === 'voice' ? '配音生成中…' : '① 生成配音') + '</button>';
    html += '<button class="btn" data-act="video-subs"' + (busy ? ' disabled' : '') + '>' + (busy === 'subs' ? '字幕生成中…' : '② 生成字幕') + '</button>';
    html += '<button class="btn" data-act="video-storyboard"' + (busy ? ' disabled' : '') + '>' + (busy === 'storyboard' ? '分镜生成中…' : '生成分镜表') + '</button>';
    var ress = [['1080x1920', '竖屏 1080x1920'], ['1920x1080', '横屏 1920x1080'], ['720x1280', '竖屏 720x1280']];
    html += '<select class="status-select" id="vd-res">';
    for (var k = 0; k < ress.length; k++) html += '<option value="' + ress[k][0] + '">' + ress[k][1] + '</option>';
    html += '</select>';
    html += '<label class="vchk"><input type="checkbox" id="vd-subs" checked> 烧字幕</label>';
    html += '<label class="vchk"><input type="checkbox" id="vd-bgm"' + (facts.hasBgm ? ' checked' : ' disabled') + '> BGM</label>';
    html += '<button class="btn primary" data-act="video-compose"' + (busy || !ffmpegOk ? ' disabled' : '') + '>' + (busy === 'compose' ? '合成中（ffmpeg）…' : '④ 合成成片') + '</button>';
    html += '</div>';
    if (p && !sayOk) html += '<div class="hint">本机没有 say 命令（需要 macOS TTS），配音不可用。</div>';
    if (p && !ffmpegOk) html += '<div class="hint">本机没有 ffmpeg：brew install ffmpeg 后可合成（配音/字幕不受影响）。</div>';
    html += '<div class="vfoot">对话同样可触发：绑定本期后说「给这期配音、出字幕、合成成片」。素材图片放 materials/（按文件名序轮播），BGM 放 bgm/，没有素材则纯色底。</div>';
    html += '</div>';
    if (!videoProbe) loadVideoProbe();
    return html;
  }

  function loadVideoProbe() {
    if (!current) return;
    fetchJson(PANEL_BASE + '/api/video/status?slug=' + encodeURIComponent(current.slug)).then(function (d) {
      if (d && d.ok) {
        videoProbe = d;
        if (currentTab === 'video') renderDetail(currentTab);
      }
    }).catch(function () { /* 探测失败下次再试 */ });
  }

  function runVideoStage(kind) {
    if (!current || busy) return;
    busy = kind;
    renderDetail(currentTab);
    var body = { slug: current.slug };
    if (kind === 'voice') {
      var vs = qs('#vd-voice');
      if (vs && vs.value) body.voice = vs.value;
    } else if (kind === 'compose') {
      var rs = qs('#vd-res');
      body.resolution = rs ? rs.value : '1080x1920';
      var cs = qs('#vd-subs');
      body.burnSubs = cs ? cs.checked : true;
      var cb = qs('#vd-bgm');
      body.withBgm = cb ? cb.checked : false;
    }
    postJson(PANEL_BASE + '/api/video/' + kind, body).then(function (d) {
      busy = null;
      if (d && d.ok) { toast(d.message || '完成'); refreshAll() }
      else { toast((d && d.error) || '操作失败'); refreshAll() }
    }).catch(function () {
      busy = null;
      toast('请求失败（长任务可能仍在后台执行）');
      renderDetail(currentTab);
    });
  }

  function docHtml(fileName, content, label) {
    if (!String(content || '').trim()) {
      return '<div class="card"><h3>' + label + ' <span class="file">' + fileName + '</span></h3>' +
        '<p style="color:var(--muted)">还没有' + label + '：在 DSH 对话里说「帮我写' + label + '」并绑定本期即可自动写盘。</p></div>';
    }
    return '<div class="card"><h3>' + label + ' <span class="file">' + fileName + '</span></h3>' +
      '<div class="md">' + mdToHtml(content) + '</div></div>';
  }

  function subsHtml(item) {
    var blocks = srtBlocks(item.files.subs);
    if (!blocks.length) {
      return '<div class="card"><h3>💬 字幕 <span class="file">subs.srt</span></h3>' +
        '<p style="color:var(--muted)">还没有字幕：生成字幕的 Skill 会把 subs.srt 写进本期目录（点击时间轴可跳转视频）。</p></div>';
    }
    var html = '<div class="card"><h3>💬 字幕 <span class="file">subs.srt</span> · ' + blocks.length + ' 条</h3>';
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      html += '<div class="subline" data-act="subs-seek" data-t="' + b.start + '">' +
        '<span class="t">' + esc(b.label) + '</span><span class="x">' + esc(b.text) + '</span></div>';
    }
    html += '</div>';
    if (!item.hasVideo) html += '<div class="hint">还没有成片，时间轴跳转需要 video.mp4。</div>';
    return html;
  }

  // ---------- 动作 ----------
  function handleAct(act, elNode) {
    if (act === 'open-item') openItem(elNode.getAttribute('data-slug'));
    else if (act === 'tab') switchTab(elNode.getAttribute('data-tab'));
    else if (act === 'refresh') refreshAll();
    else if (act === 'new-item') createNew();
    else if (act === 'copy-command') { if (current) copyText('/content ' + current.slug, '已复制：/content ' + current.slug) }
    else if (act === 'copy-path') { if (current) copyText(current.dir, '已复制目录路径') }
    else if (act === 'start-prep') {
      if (!current) return;
      postJson(PANEL_BASE + '/api/status', { slug: current.slug, status: 'preparing' }).then(function (d) {
        if (d && d.ok) { toast('已进入准备中'); refreshAll() } else toast((d && d.error) || '操作失败');
      }).catch(function () { toast('操作失败') });
    }
    else if (act === 'save-platform') savePlatform(elNode.getAttribute('data-key'));
    else if (act === 'video-voice') runVideoStage('voice');
    else if (act === 'video-subs') runVideoStage('subs');
    else if (act === 'video-storyboard') runVideoStage('storyboard');
    else if (act === 'video-compose') runVideoStage('compose');
    else if (act === 'publish-pack') runPublishPack();
    else if (act === 'publish-draft') runPublishDraft();
    else if (act === 'subs-seek') {
      var t = parseFloat(elNode.getAttribute('data-t') || '0');
      switchTab('video');
      setTimeout(function () {
        var v = qs('#studio-video');
        if (v && current && current.hasVideo) { v.currentTime = t; v.play() }
        else toast('还没有成片视频');
      }, 30);
    }
  }
  function runPublishPack() {
    if (!current || busy) return;
    busy = 'pack';
    renderDetail(currentTab);
    postJson(PANEL_BASE + '/api/publish/pack', { slug: current.slug }).then(function (d) {
      busy = null;
      if (d && d.ok) { toast('发布包已生成'); refreshAll(); }
      else { toast((d && d.error) || '生成失败'); refreshAll(); }
    }).catch(function () {
      busy = null;
      toast('请求失败');
      renderDetail(currentTab);
    });
  }
  function runPublishDraft() {
    if (!current || busy) return;
    var sel = qs('#pub-platform');
    var platform = sel && sel.value ? sel.value : 'xhs';
    busy = 'draft';
    renderDetail(currentTab);
    postJson(PANEL_BASE + '/api/publish/draft', { slug: current.slug, platform: platform, mode: 'open' }).then(function (d) {
      busy = null;
      var r = d && d.result ? d.result : d;
      if (r && r.ok) { toast(r.message || '草稿已处理'); refreshAll(); }
      else { toast((r && r.error) || (d && d.error) || '填草稿失败'); refreshAll(); }
    }).catch(function () {
      busy = null;
      toast('请求失败');
      renderDetail(currentTab);
    });
  }
  function savePlatform(key) {
    if (!current) return;
    var card = qs('#pf-' + key);
    if (!card) return;
    var body = { slug: current.slug, platform: key };
    var fields = card.querySelectorAll('[data-stat]');
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      var stat = f.getAttribute('data-stat');
      var val = f.value;
      if (stat === 'publishStatus') body.publishStatus = val;
      else if (stat === 'url') body.url = val;
      else body[stat] = val === '' ? 0 : parseInt(val, 10);
    }
    postJson(PANEL_BASE + '/api/status', body).then(function (d) {
      if (d && d.ok) { toast('平台状态已保存'); refreshAll() } else toast((d && d.error) || '保存失败');
    }).catch(function () { toast('保存失败') });
  }
  function createNew() {
    var title = prompt('新建一期内容：输入标题');
    if (!title || !title.trim()) return;
    postJson(PANEL_BASE + '/api/new', { title: title.trim() }).then(function (d) {
      if (d && d.ok) { toast('已新建：' + d.slug); loadList(d.slug) }
      else toast((d && d.error) || '新建失败');
    }).catch(function () { toast('新建失败') });
  }
  function refreshAll() {
    var slug = current ? current.slug : null;
    loadList().then(function () { if (slug) openItem(slug, true) });
  }

  // ---------- 事件委托 ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-act')) { handleAct(t.getAttribute('data-act'), t); return }
      t = t.parentNode;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var act = t.getAttribute('data-act');
    if (act === 'status-select') {
      if (!current) return;
      postJson(PANEL_BASE + '/api/status', { slug: current.slug, status: t.value }).then(function (d) {
        if (d && d.ok) { toast('状态已更新'); refreshAll() } else toast((d && d.error) || '更新失败');
      }).catch(function () { toast('更新失败') });
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-act') === 'search') {
      searchText = t.value;
      renderList();
    }
  });

  // ---------- 自动刷新 ----------
  function startTimers() {
    listTimer = setInterval(function () {
      if (!document.hidden) loadList();
    }, 15000);
    detailTimer = setInterval(function () {
      var ae = document.activeElement;
      var editing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA');
      if (!document.hidden && current && !editing && !busy) openItem(current.slug, true);
    }, 8000);
  }
  window.addEventListener('beforeunload', function () {
    if (listTimer) clearInterval(listTimer);
    if (detailTimer) clearInterval(detailTimer);
  });

  loadList();
  startTimers();
})();
</script>
</body>
</html>
`
