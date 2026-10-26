/**
 * paseo-todo state helpers.
 *
 * The todo data format mirrors opencode's `todowrite` tool protocol:
 *
 *   todos: Array<{
 *     content:  string                        // brief task description
 *     status:   "pending" | "in_progress" | "completed" | "cancelled"
 *     priority: "high" | "medium" | "low"     // optional
 *   }>
 *
 * plus paseo's `activeForm` extension, which shows the current activity
 * text while a task is in progress (displayed instead of `content`).
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
	content: string;
	status: TodoStatus;
	priority?: TodoPriority;
	/** Display text while the task is in progress (paseo parity). */
	activeForm?: string;
}

/** Data persisted per session entry (and stored in tool result details). */
export interface PaseoTodoEntryData {
	todos: TodoItem[];
	updatedAt: number;
}

/** Custom entry type used in the session file. */
export const TODO_CUSTOM_TYPE = "paseo-todo";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize an opencode-style status. Unknown statuses fall back to
 * "pending", matching paseo's normalizeOpenCodeTodoStatus behavior.
 */
export function normalizeTodoStatus(value: unknown): TodoStatus {
	if (value === "in_progress" || value === "inProgress") return "in_progress";
	if (value === "completed") return "completed";
	if (value === "cancelled" || value === "canceled") return "cancelled";
	return "pending";
}

/**
 * Normalize a todos payload into TodoItem[].
 *
 * Accepts the shapes paseo reads from opencode tool parts:
 * - `[{ content, status, priority, activeForm }]` (array form)
 * - `{ todos: [...] }` (object form)
 * - a JSON string of either
 */
export function normalizeTodos(value: unknown): TodoItem[] {
	if (typeof value === "string") {
		try {
			return normalizeTodos(JSON.parse(value));
		} catch {
			return [];
		}
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry) => {
			if (!isRecord(entry)) return [];
			const content = typeof entry.content === "string" ? entry.content.trim() : "";
			if (!content) return [];
			const item: TodoItem = { content, status: normalizeTodoStatus(entry.status) };
			if (entry.priority === "high" || entry.priority === "medium" || entry.priority === "low") {
				item.priority = entry.priority;
			}
			if (typeof entry.activeForm === "string" && entry.activeForm.trim()) {
				item.activeForm = entry.activeForm.trim();
			}
			return [item];
		});
	}
	if (isRecord(value) && Array.isArray(value.todos)) {
		return normalizeTodos(value.todos);
	}
	return [];
}

export function countCompleted(todos: readonly TodoItem[]): number {
	return todos.reduce((n, todo) => n + (todo.status === "completed" ? 1 : 0), 0);
}

export function countInProgress(todos: readonly TodoItem[]): number {
	return todos.reduce((n, todo) => n + (todo.status === "in_progress" ? 1 : 0), 0);
}

/** Compare two todo lists structurally (order matters, like opencode). */
export function sameTodos(a: readonly TodoItem[], b: readonly TodoItem[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Compact summary line, e.g. "2/5 tasks · 1 in progress". */
export function todoSummary(todos: readonly TodoItem[]): string {
	if (todos.length === 0) return "0 tasks";
	const completed = countCompleted(todos);
	if (completed === todos.length) return `${completed}/${todos.length} tasks completed`;
	const running = countInProgress(todos);
	if (running > 0) return `${completed}/${todos.length} tasks · ${running} in progress`;
	return `${completed}/${todos.length} tasks`;
}

/** Single-line live widget text, or undefined when there is nothing to show. */
export function todoWidgetText(todos: readonly TodoItem[]): string | undefined {
	if (todos.length === 0) return undefined;
	const running = todos.find((todo) => todo.status === "in_progress");
	const base = `todos ${countCompleted(todos)}/${todos.length}`;
	if (running) return `${base} · ${running.activeForm ?? running.content}`;
	return base;
}
