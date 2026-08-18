window.__ModuleLoader__.load({
	id: "jiaoyifu-studio",
	factory: (require) => {
		// jiaoyifu-studio client 半：向 dsh-better-sidebar 注册「内容工作台」Tab + .srt 预览。
		// 升级自 Oil Creator 工作台（面板仍由 host 半 /jiaoyifu/studio 内联 HTML 提供，此处只 iframe 嵌入）。
		// 零 UI 构建：手写纯 JS。inject: ['betterSidebar'] —— 服务缺失时静默不激活；host 半不受影响。
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		function studioIcon(size) {
			const s = typeof size === "number" ? size : 16;
			return React.createElement("span", {
				style: { fontSize: s, lineHeight: 1 },
				"aria-hidden": "true"
			}, "\uD83C\uDFAC");
		}

		function StudioIframe() {
			return React.createElement("iframe", {
				src: "/jiaoyifu/studio",
				title: "\u5185\u5BB9\u5DE5\u4F5C\u53F0",
				style: { width: "100%", height: "100%", border: "none", display: "block" }
			});
		}

		function parseSrt(text) {
			const blocks = String(text || "").replace(/^\uFEFF/, "").trim().split(/\n\s*\n/);
			const cues = [];
			for (const block of blocks) {
				const lines = block.split(/\r?\n/).filter(Boolean);
				if (lines.length < 2) continue;
				let i = /^\d+$/.test(lines[0]) ? 1 : 0;
				const stamp = lines[i] || "";
				const m = stamp.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
				if (!m) continue;
				cues.push({
					start: m[1].replace(".", ","),
					end: m[2].replace(".", ","),
					text: lines.slice(i + 1).join("\n")
				});
			}
			return cues;
		}

		function SrtViewer(props) {
			const cues = parseSrt(props.content);
			if (cues.length === 0) {
				return React.createElement("pre", {
					style: {
						margin: 0, padding: 12, font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
						whiteSpace: "pre-wrap", color: "var(--dsh-text, inherit)"
					}
				}, props.content || "(empty srt)");
			}
			return React.createElement("div", {
				style: { height: "100%", overflow: "auto", padding: 8, boxSizing: "border-box" }
			}, cues.map((cue, index) => React.createElement("div", {
				key: `${cue.start}-${index}`,
				style: {
					display: "grid",
					gridTemplateColumns: "auto 1fr",
					gap: "4px 10px",
					padding: "6px 8px",
					borderRadius: 6,
					marginBottom: 4,
					background: index % 2 === 0 ? "rgba(77, 107, 254, 0.10)" : "transparent"
				}
			},
				React.createElement("code", {
					style: { color: "#4d6bfe", fontSize: 11, whiteSpace: "nowrap" }
				}, `${cue.start} \u2192 ${cue.end}`),
				React.createElement("div", { style: { fontSize: 13, whiteSpace: "pre-wrap" } }, cue.text)
			)));
		}

		const inject = ["betterSidebar"];

		function apply(ctx) {
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: "jiaoyifu-studio:panel",
				title: () => "\u5185\u5BB9\u5DE5\u4F5C\u53F0",
				icon: studioIcon,
				order: 45,
				single: true,
				component: () => React.createElement(StudioIframe)
			}));
			ctx.effect(() => ctx.betterSidebar.registerFileViewer({
				id: "jiaoyifu-studio:srt",
				title: () => "SRT \u5B57\u5E55",
				icon: studioIcon,
				exts: ["srt"],
				priority: 10,
				fetchStrategy: "fsRead",
				component: (props) => React.createElement(SrtViewer, props)
			}));
		}

		exports.inject = inject;
		exports.apply = apply;
		module.exports = { inject, apply };
		return module.exports;
	}
});
