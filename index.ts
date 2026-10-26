/**
 * paseo-todo: opencode-style todo cards for pi.
 *
 * Reproduces the todo UX paseo builds on top of opencode:
 * - A `todowrite` tool speaking opencode's todo protocol
 *   (`{ todos: [{ content, status, priority }] }`), so models trained on
 *   opencode's tool usage call it naturally.
 * - A persistent todo card pinned below the editor (paseo's left-bottom
 *   composer card): always visible while tasks exist, toggleable to a
 *   one-line pill with `ctrl+shift+t`.
 * - State is persisted in the session, so `/resume` and `/reload` restore
 *   the list.
 *
 * Install: `pi install npm:paseo-todo`, or drop this directory under
 * `~/.pi/agent/extensions/` (global) / `.pi/extensions/` (project-local),
 * then restart pi or run /reload.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	TODO_CUSTOM_TYPE,
	countCompleted,
	normalizeTodos,
	sameTodos,
	todoSummary,
	type PaseoTodoEntryData,
	type TodoItem,
} from "./state.ts";

const WIDGET_ID = "paseo-todo";
const TOOL_NAME = "todowrite";
const TOGGLE_SHORTCUT = "ctrl+shift+t";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when nothing is left to do: every task is completed or cancelled.
 * Such a list auto-collapses to the one-line pill instead of pinning the
 * full card below the editor.
 */
function allSettled(todos: readonly TodoItem[]): boolean {
	return (
		todos.length > 0 &&
		todos.every((todo) => todo.status === "completed" || todo.status === "cancelled")
	);
}

/** Rebuild in-memory state from the last persisted entry in the session. */
function restoreTodos(ctx: ExtensionContext): TodoItem[] {
	let restored: TodoItem[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== TODO_CUSTOM_TYPE) continue;
		const data = entry.data;
		if (isRecord(data) && Array.isArray(data.todos)) {
			restored = normalizeTodos(data.todos);
		}
	}
	return restored;
}

/** Render one todo row: status mark + text (paseo TaskListRow styling). */
function todoRowText(todo: TodoItem, theme: Theme): string {
	switch (todo.status) {
		case "completed":
			return `${theme.fg("success", "✓")} ${theme.strikethrough(theme.fg("muted", todo.content))}`;
		case "in_progress": {
			const text = todo.activeForm ?? todo.content;
			return `${theme.fg("accent", "●")} ${theme.fg("accent", text)}`;
		}
		case "cancelled":
			return `${theme.fg("dim", "○")} ${theme.fg("dim", todo.content)}`;
		default:
			return `${theme.fg("dim", "○")} ${theme.fg("muted", todo.content)}`;
	}
}

/**
 * Build the widget lines for the editor-bottom card.
 * Empty list → return undefined so the widget area is collapsed.
 */
function buildWidgetLines(
	todos: readonly TodoItem[],
	compact: boolean,
	theme: Theme,
): string[] | undefined {
	if (todos.length === 0) return undefined;

	if (compact) {
		// One-line pill matching paseo's collapsed composer pill.
		const label = theme.fg("muted", "paseo-todo");
		const settled = allSettled(todos);
		// A settled list counts cancelled tasks as done too.
		const doneCount = settled ? todos.length : countCompleted(todos);
		const progress = theme.fg("muted", `${doneCount}/${todos.length} tasks`);
		const done = settled ? ` ${theme.fg("success", "✓ done")}` : "";
		const hint = theme.fg("dim", ` (${TOGGLE_SHORTCUT} expand)`);
		return [`${label}  ${progress}${done}${hint}`];
	}

	const lines: string[] = [];
	lines.push(`${theme.fg("muted", "paseo-todo")}  ${theme.fg("muted", `${countCompleted(todos)}/${todos.length} tasks`)}  ${theme.fg("dim", `(${TOGGLE_SHORTCUT} collapse)`)}`);
	for (const todo of todos) {
		lines.push(todoRowText(todo, theme));
	}
	return lines;
}

export default function (pi: ExtensionAPI) {
	let todos: TodoItem[] = [];
	let compact = false;
	// Set when the user expands an already-settled list with ctrl+shift+t.
	let expandSettled = false;

	/** A settled list is a pill unless the user explicitly expanded it. */
	function compactView(): boolean {
		return allSettled(todos) ? !expandSettled : compact;
	}

	function refreshWidget(ctx: ExtensionContext): void {
		const lines = buildWidgetLines(todos, compactView(), ctx.ui.theme);
		ctx.ui.setWidget(WIDGET_ID, lines, { placement: "belowEditor" });
	}

	function persist(ctx: ExtensionContext): void {
		pi.appendEntry<PaseoTodoEntryData>(TODO_CUSTOM_TYPE, {
			todos,
			updatedAt: Date.now(),
		});
		refreshWidget(ctx);
	}

	// ------------------------------------------------------------------
	// Session restore: /resume, /reload and forks rebuild the todo list
	// from the last persisted entry, and the bottom card comes back.
	// ------------------------------------------------------------------
	pi.on("session_start", (_event, ctx) => {
		todos = restoreTodos(ctx);
		compact = todos.length > 0 ? compact : false;
		expandSettled = false;
		refreshWidget(ctx);
	});

	// ------------------------------------------------------------------
	// ctrl+shift+t toggles between the compact pill and the full card.
	// Only active while a todo list exists; if there are no tasks, the
	// widget is hidden anyway and the shortcut is a no-op. An already
	// settled list lives in the pill, so the shortcut expands it back.
	// ------------------------------------------------------------------
	pi.registerShortcut(TOGGLE_SHORTCUT, {
		description: "Toggle paseo-todo card (compact pill ↔ full list)",
		handler: async (ctx) => {
			if (todos.length === 0) return;
			if (allSettled(todos)) {
				expandSettled = !expandSettled;
			} else {
				compact = !compact;
			}
			refreshWidget(ctx);
		},
	});

	// ------------------------------------------------------------------
	// todowrite tool — opencode-compatible protocol. The full list is
	// passed on every call and replaces the previous list.
	// ------------------------------------------------------------------
	pi.registerTool({
		name: TOOL_NAME,
		label: "Write Todos",
		description:
			"Write and update the session todo list. Call it when the user asks to plan, break down, or track multi-step work. " +
			"The todos array replaces the entire previous list, so always pass the full current list with updated statuses. " +
			"Statuses: pending (not started), in_progress (currently working on it), completed (done), cancelled (dropped). " +
			"Keep content brief and atomic; use activeForm to describe the current activity of the in_progress task.",
		promptSnippet: "Plan and track work as a todo list",
		promptGuidelines: [
			"Use todowrite when the user asks to plan a task, track progress, or at the start of multi-step work — it pins a persistent card below the editor (toggle with ctrl+shift+t) and the list survives across the session.",
		],
		parameters: Type.Object({
			todos: Type.Array(
				Type.Object({
					content: Type.String({ description: "Brief description of the task" }),
					status: Type.Optional(
						StringEnum(["pending", "in_progress", "completed", "cancelled"] as const),
					),
					priority: Type.Optional(StringEnum(["high", "medium", "low"] as const)),
					activeForm: Type.Optional(
						Type.String({
							description:
								"Current activity text shown while the task is in_progress (displayed instead of content)",
						}),
					),
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const next = normalizeTodos(params?.todos);
			const changed = !sameTodos(todos, next);
			todos = next;
			if (changed) {
				// A fresh list starts from the default view, not an expanded one.
				expandSettled = false;
				persist(ctx);
			} else {
				refreshWidget(ctx);
			}
			const summary = todoSummary(todos);
			return {
				content: [{ type: "text", text: `Todo list updated: ${summary}` }],
				details: { todos, summary },
			};
		},
		renderCall(args, theme) {
			const list = normalizeTodos(isRecord(args) ? args.todos : undefined);
			const label = list.length > 0 ? `${list.length} tasks` : "clear todos";
			return new Text(theme.fg("toolTitle", theme.bold("todowrite ")) + theme.fg("muted", label), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = isRecord(result.details) ? result.details : undefined;
			const list = normalizeTodos(details?.todos);
			let text = theme.fg("success", "✓ ") + theme.fg("muted", todoSummary(list));
			if (expanded) {
				for (const todo of list) {
					text += "\n  " + todoRowText(todo, theme);
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// ------------------------------------------------------------------
	// /todo — show the current list without touching the LLM.
	// ------------------------------------------------------------------
	pi.registerCommand("todo", {
		description: "Show the current paseo-todo list",
		handler: async (_args, ctx) => {
			if (todos.length === 0) {
				ctx.ui.notify("paseo-todo: no tasks", "info");
				return;
			}
			ctx.ui.notify(
				`paseo-todo ${todoSummary(todos)}\n${todos.map((todo) => `  ${todo.status} · ${todo.content}`).join("\n")}`,
				"info",
			);
		},
	});
}
