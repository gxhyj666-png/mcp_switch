window.__ModuleLoader__.load({
	id: "dsh-mcp-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;
		const useState = react.useState;
		const useEffect = react.useEffect;
		const useCallback = react.useCallback;

		const ENDPOINT = "/dsh-mcp-panel";

		/* ---------- styles (inline,借用外壳的 CSS 变量，缺了就退回灰阶) ---------- */
		const css = {
			root: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 2px 18px" },
			head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
			title: { margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #1f2328)" },
			sub: { margin: 0, fontSize: "12px", lineHeight: "18px", color: "var(--dsw-alias-label-tertiary, #6e7781)" },
			btn: {
				appearance: "none",
				cursor: "pointer",
				height: "28px",
				padding: "0 12px",
				borderRadius: "8px",
				border: "1px solid var(--dsw-alias-border-l1, #d0d7de)",
				background: "var(--dsw-alias-fill-l1, transparent)",
				color: "var(--dsw-alias-label-primary, #1f2328)",
				fontSize: "12px",
			},
			banner: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "10px",
				padding: "10px 12px",
				borderRadius: "10px",
				background: "var(--dsw-alias-fill-l2, #f6f8fa)",
				border: "1px solid var(--dsw-alias-border-l1, #d0d7de)",
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary, #57606a)",
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				padding: "12px",
				borderRadius: "12px",
				border: "1px solid var(--dsw-alias-border-l1, #d0d7de)",
				background: "var(--dsw-alias-fill-l1, #fff)",
			},
			rowText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 },
			name: { fontSize: "13px", fontWeight: 600, color: "var(--dsw-alias-label-primary, #1f2328)" },
			meta: {
				fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)",
				fontSize: "11px",
				lineHeight: "16px",
				color: "var(--dsw-alias-label-tertiary, #6e7781)",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
			},
			badge: {
				flex: "none",
				padding: "1px 7px",
				borderRadius: "6px",
				fontSize: "11px",
				lineHeight: "18px",
				background: "var(--dsw-alias-fill-l2, #f6f8fa)",
				color: "var(--dsw-alias-label-secondary, #57606a)",
			},
			swTrack: (on) => ({
				position: "relative",
				flex: "none",
				width: "38px",
				height: "22px",
				borderRadius: "11px",
				cursor: "pointer",
				transition: "background .15s",
				background: on ? "var(--dsw-alias-accent, #2f81f7)" : "var(--dsw-alias-border-l2, #d0d7de)",
				border: "0",
				padding: 0,
			}),
			swKnob: (on) => ({
				position: "absolute",
				top: "3px",
				left: on ? "19px" : "3px",
				width: "16px",
				height: "16px",
				borderRadius: "50%",
				background: "#fff",
				boxShadow: "0 1px 2px rgba(0,0,0,.3)",
				transition: "left .15s",
			}),
			err: {
				padding: "10px 12px",
				borderRadius: "10px",
				background: "var(--dsw-alias-fill-l2, #fff5f5)",
				border: "1px solid var(--dsw-alias-border-l1, #ffb3b3)",
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary, #b42318)",
				whiteSpace: "pre-wrap",
			},
		};

		/* ---------- data ---------- */
		async function getState() {
			const res = await fetch(`${ENDPOINT}/state`, { headers: { accept: "application/json" } });
			if (!res.ok) throw new Error(`state ${res.status}: ${await res.text()}`);
			return res.json();
		}

		async function toggle(id, enabled) {
			const res = await fetch(`${ENDPOINT}/toggle`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id, enabled }),
			});
			if (!res.ok) throw new Error(`toggle ${res.status}: ${await res.text()}`);
			return res.json();
		}

		async function restart() {
			const res = await fetch(`${ENDPOINT}/restart`, { method: "POST" });
			if (!res.ok) throw new Error(`restart ${res.status}: ${await res.text()}`);
			return res.json();
		}

		/* ---------- view ---------- */
		function Switch(props) {
			const on = props.checked;
			return h(
				"button",
				{
					type: "button",
					role: "switch",
					"aria-checked": on,
					"aria-label": `${on ? "关闭" : "开启"} ${props.label}`,
					title: on ? "点击关闭" : "点击开启",
					style: css.swTrack(on),
					disabled: props.busy,
					onClick: props.onToggle,
				},
				h("span", { style: css.swKnob(on) }),
			);
		}

		function Row(props) {
			const entry = props.entry;
			const detail = entry.transport === "stdio" ? [entry.command, ...(entry.args || [])].join(" ") : entry.url || entry.transport;
			return h(
				"div",
				{ style: css.row },
				h(
					"div",
					{ style: css.rowText },
					h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, h("span", { style: css.name }, entry.serverName), h("span", { style: css.badge }, entry.id)),
					h("div", { style: css.meta, title: detail }, detail),
					entry.pendingRestart
						? h("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-warning, #9a6700)" } }, `配置为「${entry.enabled ? "开启" : "关闭"}」，重启后生效`)
						: null,
				),
				h(Switch, {
					checked: entry.enabled,
					busy: props.busy,
					label: entry.serverName,
					onToggle: () => props.onToggle(entry),
				}),
			);
		}

		function Panel() {
			const [state, setState] = useState(null);
			const [error, setError] = useState(null);
			const [busy, setBusy] = useState(false);

			const load = useCallback(async () => {
				try {
					setState(await getState());
					setError(null);
				} catch (e) {
					setError(String(e && e.message ? e.message : e));
				}
			}, []);

			useEffect(() => {
				load();
			}, [load]);

			const onToggle = useCallback(
				async (entry) => {
					setBusy(true);
					try {
						const result = await toggle(entry.id, !entry.enabled);
						setState(result.state);
						setError(null);
					} catch (e) {
						setError(String(e && e.message ? e.message : e));
					} finally {
						setBusy(false);
					}
				},
				[],
			);

			const onRestart = useCallback(() => {
				const ok = window.confirm("重启 DSH Desktop 以应用改动？\n\n当前对话的这一轮会中断，会话记录会保留。");
				if (!ok) return;
				restart().catch((e) => setError(String(e && e.message ? e.message : e)));
			}, []);

			const entries = (state && state.entries) || [];
			const pending = Boolean(state && state.pendingRestart);

			return h(
				"div",
				{ style: css.root },
				h(
					"div",
					{ style: css.head },
					h(
						"div",
						null,
						h("h3", { style: css.title }, "MCP 服务器"),
						h(
							"p",
							{ style: css.sub },
							"逐个启停 profile patch 里的 MCP 条目。改动写入 cordis.patch.yml，重启宿主后生效。",
						),
					),
					h("button", { type: "button", style: css.btn, onClick: load, disabled: busy }, "刷新"),
				),
				pending
					? h(
							"div",
							{ style: css.banner },
							h("span", null, "有未生效的改动 —— 需要重启 DSH Desktop。"),
							h("button", { type: "button", style: css.btn, onClick: onRestart }, "立即重启"),
						)
					: null,
				error ? h("div", { style: css.err }, error) : null,
				state === null && !error ? h("div", { style: css.sub }, "载入中…") : null,
				state !== null && entries.length === 0
					? h(
							"div",
							{ style: css.sub },
							`没有找到 MCP 条目。检查 ${state.patchPath} 里是否有 name: '@deepseek-ai/dsh-mcp-client' 的条目。`,
						)
					: null,
				entries.map((entry) => h(Row, { key: entry.id, entry, busy, onToggle })),
				state !== null
					? h(
							"p",
							{ style: { ...css.sub, marginTop: "2px" } },
							`宿主 PID ${state.hostPid} · 启动于 ${state.bootedAt || "未知"} · ${state.patchPath}`,
						)
					: null,
			);
		}

		/* ---------- registration ---------- */
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("settings.plugins.tab", () =>
				ctx.slots.register(
					{
						name: "settings.plugins.tab",
						id: "mcp",
						order: 30,
						label: () => "MCP 开关",
					},
					Panel,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
